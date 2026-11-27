// The pointer-punning view (`punning` traces): byte-accurate memory strip with HUD scope reticle,
// out-of-bounds UB caliper and hazard hatch, bidirectional byte-tile flights, and live LE/BE switch.
import { hexByte } from '../core/bytes.ts';
import {
  type ActivePunPointer,
  type PaneReadReplacement,
  type PunningSimState,
  hasLargerPointerAccess,
  hasUninitializedRead,
  punningMinEndAddress,
  simulatePunningTrace,
} from '../core/punning.ts';
import type { Span, TraceStep, TypedPart } from '../core/trace_format.ts';
import {
  BYTE_CELL_HEIGHT,
  type ByteCellState,
  type ByteVariableState,
  colorPoisonHexInSvg,
  flushAddrPos,
  hatchDefs,
  renderByteMemory,
  scaledAt,
  transientReadHighlight,
  transientWriteHighlight,
} from './byte_memory.ts';
import { CHAR, EASE, LABEL, T } from './constants.ts';
import { type PointerLink, links } from './geometry.ts';
import { type PreparedModel, arrival, copies, departure, stepSeconds } from './model.ts';
import { type SceneContext, code, dim, output, pane, tether, transfers } from './scene.ts';
import { fade, hide, rect, round, show, text } from './svg.ts';
import type { TraceView } from './views.ts';

function pill(
  cx: number,
  cy: number,
  label: string,
  size: number,
  fill: string,
  stroke: string,
  ink: string
): string {
  const w = label.length * size * CHAR + 16;
  const h = size + 10;
  return (
    rect(cx - w / 2, cy - h / 2, w, h, fill, stroke, h / 2, 1.8) +
    text(cx, cy + size * 0.35, label, size, ink, 'middle')
  );
}

/** Shift `[start, end)` after replacing `[at, at + oldLen)` with length `oldLen + delta`. */
function shiftSpan(span: Span, at: number, oldLen: number, delta: number): Span {
  if (delta === 0) return span;
  const oldEnd = at + oldLen;
  const s = span[0] >= oldEnd ? span[0] + delta : span[0];
  const e = span[1] >= oldEnd ? span[1] + delta : span[1];
  return [s, e];
}

function patchTypedParts(
  parts: TypedPart[] | undefined,
  at: number,
  oldLen: number,
  delta: number
): TypedPart[] | undefined {
  if (!parts || delta === 0) return parts;
  return parts.map(part => ({ ...part, span: shiftSpan(part.span, at, oldLen, delta) }));
}

/**
 * Patch `step` and `prev` panes when toggling Little-endian / Big-endian changes the value
 * produced by a punning read (or a read of a poisoned/endian-dependent variable).
 * Uses exact spans recorded by `simulatePunningTrace`, shifts `op.span` on `prev`-indexed ops,
 * and preserves `c.op === null` on settled renders.
 */
function resolveEndianContext(c: SceneContext, sim: PunningSimState): SceneContext {
  const prevRep = sim.prevPaneReadReplacement;
  const prevDelta =
    prevRep && prevRep.resolvedValue !== prevRep.originalValue
      ? prevRep.resolvedValue.length - prevRep.originalValue.length
      : 0;

  const shiftAgainstPrev = (span: Span): Span => {
    if (!prevRep || prevDelta === 0) return span;
    return shiftSpan(span, prevRep.span[0], prevRep.originalValue.length, prevDelta);
  };

  const patchStep = (
    st: TraceStep | null,
    idx: number,
    rep: PaneReadReplacement | null,
    isCurrent: boolean
  ): TraceStep | null => {
    if (!st) return null;
    const hasRep = Boolean(rep && rep.resolvedValue !== rep.originalValue);
    let patchedPane = st.pane;
    let patchedExpr = st.expr;
    let patchedTypes = st.types;
    let patchedOp = st.op;

    if (hasRep && rep) {
      const { originalValue, resolvedValue, span } = rep;
      const [at, end] = span;
      if (st.pane.slice(at, end) === originalValue) {
        const delta = resolvedValue.length - originalValue.length;
        patchedPane = st.pane.slice(0, at) + resolvedValue + st.pane.slice(end);
        patchedExpr = st.expr ? shiftSpan(st.expr, at, originalValue.length, delta) : st.expr;
        patchedTypes = patchTypedParts(st.types, at, originalValue.length, delta);
        if (idx === rep.stepIndex && (patchedOp?.kind === 'read' || patchedOp?.kind === 'convert' || patchedOp?.kind === 'eval')) {
          patchedOp = { ...patchedOp, value: resolvedValue };
        } else if (patchedOp?.kind === 'write' && patchedOp.span[0] === at && patchedOp.span[1] === end) {
          patchedOp = {
            ...patchedOp,
            value: resolvedValue,
            span: [at, at + resolvedValue.length],
            destination: shiftSpan(patchedOp.destination, at, originalValue.length, delta),
          };
        }
      }
    }

    // Operations whose `span` indexes `prev.pane` must track length changes made to `prev.pane`.
    if (
      isCurrent &&
      prevDelta !== 0 &&
      patchedOp &&
      (patchedOp.kind === 'convert' ||
        patchedOp.kind === 'eval' ||
        patchedOp.kind === 'read' ||
        patchedOp.kind === 'deref' ||
        patchedOp.kind === 'addr')
    ) {
      const nextSpan = shiftAgainstPrev(patchedOp.span);
      const nextOperator =
        patchedOp.kind === 'convert' && patchedOp.operator
          ? shiftAgainstPrev(patchedOp.operator)
          : undefined;
      if (
        nextSpan[0] !== patchedOp.span[0] ||
        nextSpan[1] !== patchedOp.span[1] ||
        (nextOperator &&
          patchedOp.kind === 'convert' &&
          patchedOp.operator &&
          (nextOperator[0] !== patchedOp.operator[0] || nextOperator[1] !== patchedOp.operator[1]))
      ) {
        patchedOp =
          patchedOp.kind === 'convert' && nextOperator
            ? { ...patchedOp, span: nextSpan, operator: nextOperator }
            : { ...patchedOp, span: nextSpan };
      }
    }

    if (
      patchedPane === st.pane &&
      patchedExpr === st.expr &&
      patchedTypes === st.types &&
      patchedOp === st.op
    ) {
      return st;
    }
    return {
      ...st,
      pane: patchedPane,
      expr: patchedExpr,
      op: patchedOp,
      ...(patchedTypes ? { types: patchedTypes } : {}),
    };
  };

  const step = patchStep(c.step, c.index, sim.paneReadReplacement, true)!;
  const prev = patchStep(c.prev, c.index - 1, sim.prevPaneReadReplacement, false);
  if (step === c.step && prev === c.prev) return c;
  // Preserve `c.op === null` on settled renders so the pane stays settled rather than animating at t = 0.
  return { ...c, step, prev, op: c.op ? step.op : null };
}

/** Whether storing the result of a punning or poisoned read should fly per-byte tiles instead of a scalar box. */
function usesByteTileStore(sim: PunningSimState): boolean {
  const st = sim.storeAfterPunRead;
  if (st && (st.readResult.poisoned || st.bytes.length > 1)) return true;
  return Boolean(sim.storeAfterPoisonRead);
}

function punningStepSeconds(m: PreparedModel, index: number): number {
  const step = m.steps[index];
  const op = step.op;
  if (op?.kind === 'write' && op.pun) return step.hold + 2.3;
  if (op?.kind === 'read' && op.pun) return step.hold + 2.2;
  if (op?.kind === 'read') {
    const sim = simulatePunningTrace(m.trace, index, true);
    if (sim.activePoisonRead) return step.hold + 2.2;
  }
  if (op?.kind === 'write') {
    const sim = simulatePunningTrace(m.trace, index, true);
    if (usesByteTileStore(sim)) return step.hold + 2.1;
  }
  return stepSeconds(m.steps, index);
}

// ============================================================================================
// FULL-HEIGHT OPEN HUD CORNER RETICLE (APPROVED OPTION A)
// ============================================================================================

function drawHudReticle(
  bx: number,
  by: number,
  bw: number,
  bh: number,
  leftCol: string,
  rightCol: string,
  splitX: number | null
): string {
  const arm = Math.min(14, bw * 0.28);
  const tick = 5;
  const rx = bx + bw;
  const ry = by + bh;
  const mx = bx + bw / 2;
  const my = by + bh / 2;
  const rightTopCol = splitX !== null ? rightCol : leftCol;
  const topTickCol = splitX !== null && mx >= splitX ? rightCol : leftCol;

  let out = '';
  if (splitX !== null) {
    out +=
      `<path d="M ${round(splitX)} ${round(by)} H ${round(bx)} V ${round(ry)} H ${round(splitX)}" fill="none" stroke="${leftCol}" stroke-opacity="0.32" stroke-dasharray="3 3" stroke-width="1.3"/>` +
      `<path d="M ${round(splitX)} ${round(by)} H ${round(rx)} V ${round(ry)} H ${round(splitX)}" fill="none" stroke="${rightCol}" stroke-opacity="0.4" stroke-dasharray="3 3" stroke-width="1.3"/>`;
  } else {
    out += `<rect x="${round(bx)}" y="${round(by)}" width="${round(bw)}" height="${round(bh)}" fill="none" stroke="${leftCol}" stroke-opacity="0.32" stroke-dasharray="3 3" stroke-width="1.3"/>`;
  }
  out +=
    `<path d="M ${round(bx)} ${round(by + arm)} V ${round(by)} H ${round(bx + arm)}" fill="none" stroke="${leftCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<path d="M ${round(bx)} ${round(ry - arm)} V ${round(ry)} H ${round(bx + arm)}" fill="none" stroke="${leftCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<path d="M ${round(rx - arm)} ${round(by)} H ${round(rx)} V ${round(by + arm)}" fill="none" stroke="${rightTopCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<path d="M ${round(rx - arm)} ${round(ry)} H ${round(rx)} V ${round(ry - arm)}" fill="none" stroke="${rightTopCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<line x1="${round(mx)}" y1="${round(by)}" x2="${round(mx)}" y2="${round(by + tick)}" stroke="${topTickCol}" stroke-width="2.2"/>` +
    `<line x1="${round(mx)}" y1="${round(ry)}" x2="${round(mx)}" y2="${round(ry - tick)}" stroke="${topTickCol}" stroke-width="2.2"/>` +
    `<line x1="${round(bx)}" y1="${round(my)}" x2="${round(bx + tick)}" y2="${round(my)}" stroke="${leftCol}" stroke-width="2.2"/>` +
    `<line x1="${round(rx)}" y1="${round(my)}" x2="${round(rx - tick)}" y2="${round(my)}" stroke="${rightTopCol}" stroke-width="2.2"/>`;
  return out;
}

function punReticle(
  c: SceneContext,
  sim: PunningSimState,
  ptr: ActivePunPointer,
  posOf: (addr: number) => { x: number; y: number },
  byteW: number,
  cellH: number,
  pCol: string
): string {
  const { P, animate, op } = c;
  const at = op ? arrival(op) : 0;
  const dep = op ? departure(op) : 0;
  const startPos = posOf(ptr.targetAddress);
  const wLeft = startPos.x;
  const rowY = startPos.y;
  const wWidth = ptr.pointeeSize * byteW;
  const ownEnd = wLeft + ptr.targetSize * byteW;

  const pad = 3.5;
  const bx = wLeft - pad;
  const by = rowY - pad;
  const bw = wWidth + 2 * pad;
  const bh = cellH + 2 * pad;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  const isWritingPtr = animate && op?.kind === 'write' && op.name === ptr.ptrName;
  const isDeref = animate && op?.kind === 'deref' && op.via === ptr.ptrName;
  const isPunRead = sim.activePun?.kind === 'read' && sim.activePun.pun.via === ptr.ptrName;
  const isPunWrite = sim.activePun?.kind === 'write' && sim.activePun.pun.via === ptr.ptrName;
  const opCol =
    ptr.ubKind === 'read' || isPunRead || sim.storeAfterPunRead?.pun.via === ptr.ptrName
      ? P.read
      : P.write;

  let inner = '';
  if (ptr.direction === 'larger' && ptr.ubKind !== 'none') {
    const calm = drawHudReticle(bx, by, bw, bh, pCol, pCol, null);
    const breached = drawHudReticle(bx, by, bw, bh, opCol, P.error, ownEnd);
    const triggerAt = isPunRead ? dep : at;
    inner =
      animate && ptr.ubTriggeredNow && (isPunWrite || isPunRead)
        ? `<g>${hide(triggerAt)}${calm}</g><g opacity="0">${show(triggerAt)}${breached}</g>`
        : breached;
  } else {
    const col = ptr.windowActive ? opCol : pCol;
    inner = drawHudReticle(bx, by, bw, bh, col, col, null);
  }

  let wrapped = inner;
  if (isWritingPtr) {
    const lockBegin = at + 0.52;
    wrapped =
      `<g opacity="0">${fade(0, 1, 0.14, lockBegin)}` +
      `<g transform="translate(${round(cx)} ${round(cy)})"><g>` +
      `<animateTransform attributeName="transform" type="scale" values="1.28;0.96;1" keyTimes="0;0.74;1" ` +
      `calcMode="spline" keySplines="0.2 0 0.2 1;0.4 0 0.2 1" begin="${round(lockBegin)}s" dur="0.46s" fill="freeze"/>` +
      `<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g></g>`;
  } else if (isDeref) {
    wrapped = scaledAt(cx, cy, inner, at - 0.18);
  }
  return `<g class="cv-pun-reticle" data-ptr="${ptr.ptrName}">${wrapped}</g>`;
}

// ============================================================================================
// CLEAN OVERHEAD POINTER ARCS (ALL LIFTED CLEAR OF THE PER-BYTE ADDRESS RULER)
// ============================================================================================

function punningArrows(
  c: SceneContext,
  sim: PunningSimState,
  posOf: (addr: number) => { x: number; y: number },
  byteW: number
): string {
  const { g, P, step, prev, op, animate } = c;
  const punNames = new Set(sim.punPointers.map(p => p.ptrName));
  const at = op ? arrival(op) : 0;

  const arcGeom = (l: PointerLink, isPun: boolean): { d: string; hx: number; hy: number } => {
    const toPos = posOf(l.to.address);
    const ex = isPun ? toPos.x + byteW * 0.5 : l.head[0];
    const ey = toPos.y - 26;
    if (Math.abs(l.from.y - toPos.y) < 1) {
      const sx = l.from.x + l.from.w / 2;
      const sy = l.from.y - 2;
      const apex = toPos.y - 92 - l.level * 36;
      return {
        d: `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(apex)}, ${round(ex)} ${round(apex)}, ${round(ex)} ${round(ey - 8)}`,
        hx: ex,
        hy: ey,
      };
    }
    // Cross-row pointer: exit the left edge of the pointer cell, travel cleanly up the left
    // margin outside the memory cells, and arch into the target byte from above.
    const sx = l.from.x;
    const sy = l.from.y + l.from.h * 0.5;
    const gx = g.memX - 28 - l.level * 10;
    const topY = toPos.y - 54 - l.level * 22;
    return {
      d:
        `M ${round(sx)} ${round(sy)} ` +
        `Q ${round(gx)} ${round(sy)}, ${round(gx)} ${round(sy - 20)} ` +
        `L ${round(gx)} ${round(topY + 20)} ` +
        `Q ${round(gx)} ${round(topY)}, ${round(gx + 20)} ${round(topY)} ` +
        `L ${round(ex - 16)} ${round(topY)} ` +
        `Q ${round(ex)} ${round(topY)}, ${round(ex)} ${round(ey - 8)}`,
      hx: ex,
      hy: ey,
    };
  };

  const arcFor = (
    l: PointerLink,
    isPun: boolean,
    opts: { grow?: number | null; fadeOut?: number | null; keepBright?: boolean } = {}
  ): string => {
    const col = l.from.color;
    const { d, hx, hy } = arcGeom(l, isPun);
    const grow = opts.grow != null ? ` data-grow="${round(opts.grow)}"` : '';
    const head = `<path d="M -10 -6 L 0 0 L -10 6 Z" fill="${col}" transform="translate(${round(hx)} ${round(hy)}) rotate(90)"/>`;
    const body =
      '<g>' +
      (opts.fadeOut != null ? fade(1, 0, 0.3, opts.fadeOut) : '') +
      `<path d="${d}" fill="none" stroke="${P.bg}" stroke-width="9"${grow}/>` +
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.6"${grow}/>` +
      (opts.grow != null ? `<g opacity="0">${fade(0, 1, 0.15, opts.grow + 0.47)}${head}</g>` : head) +
      '</g>';
    return opts.keepBright ? body : dim(c, l.from.name, body);
  };

  const activeArcPtrs = new Set<string>();
  if (sim.activePun) activeArcPtrs.add(sim.activePun.pun.via);
  if (sim.storeAfterPunRead) activeArcPtrs.add(sim.storeAfterPunRead.pun.via);
  if (op?.kind === 'write' && punNames.has(op.name)) activeArcPtrs.add(op.name);
  if (op?.kind === 'deref' && punNames.has(op.via)) activeArcPtrs.add(op.via);

  const now = links(g, step);
  const writesPtr =
    animate && op?.kind === 'write' && g.cellsOf(op.name).some(l => l.kind === 'ptr');
  if (writesPtr && prev) {
    const prevPunNames = new Set(
      simulatePunningTrace(c.m.trace, Math.max(0, c.index - 1), c.littleEndian).punPointers.map(p => p.ptrName)
    );
    const changed = new Set(g.cellsOf(op.name).map(l => l.name));
    let out = '';
    for (const l of links(g, prev)) {
      const isOutgoing = changed.has(l.from.name);
      const isPun = isOutgoing ? prevPunNames.has(l.from.name) : punNames.has(l.from.name);
      out += arcFor(l, isPun, {
        ...(isOutgoing ? { fadeOut: at } : {}),
        keepBright: activeArcPtrs.has(l.from.name),
      });
    }
    for (const l of now) {
      if (changed.has(l.from.name)) {
        out += arcFor(l, punNames.has(l.from.name), { grow: at + 0.08, keepBright: activeArcPtrs.has(l.from.name) });
      }
    }
    return out;
  }

  let out = now.map(l => arcFor(l, punNames.has(l.from.name), { keepBright: activeArcPtrs.has(l.from.name) })).join('');
  if (animate && op?.kind === 'deref') {
    const l = now.find(link => link.from.name === op.via);
    if (l) {
      const isPun = punNames.has(l.from.name);
      const { d } = arcGeom(l, isPun);
      const pulsePath = `<path d="${d}" fill="none" stroke="${l.from.color}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`;
      out += isPun ? pulsePath : dim(c, l.from.name, pulsePath);
    }
  }
  return out;
}

// ============================================================================================
// UNIFIED PUNNING SCENE
// ============================================================================================

function punningScene(c: SceneContext): string {
  const sim = simulatePunningTrace(c.m.trace, c.index, c.littleEndian);
  const { g, P, animate, op, step, prev } = c;
  const { defs, padId, ubId } = hatchDefs(P);
  const lineChanged = animate && prev !== null && prev.line !== step.line;
  const oldLine = lineChanged && prev ? prev.line : null;

  const byteW = g.byteWidth;
  const cellH = g.leaves[0]?.h ?? BYTE_CELL_HEIGHT;
  const posOf = (addr: number) => flushAddrPos(g, addr);
  const at = op ? arrival(op) : 0;
  const dep = op ? departure(op) : 0;

  const isPunWrite = sim.activePun?.kind === 'write';
  const isPunRead = sim.activePun?.kind === 'read';
  const isPoisonRead = sim.activePoisonRead !== null;
  const byteTileStore = usesByteTileStore(sim);
  const involvedNames = new Set<string>();
  if (sim.activePun) {
    involvedNames.add(sim.activePun.pun.via);
    involvedNames.add(sim.activePun.targetName);
  }
  if (sim.activePoisonRead) {
    involvedNames.add(sim.activePoisonRead.varName);
  }
  if (sim.storeAfterPunRead) {
    involvedNames.add(sim.storeAfterPunRead.destVar.name);
    involvedNames.add(sim.storeAfterPunRead.pun.via);
    involvedNames.add(sim.punPointers.find(p => p.ptrName === sim.storeAfterPunRead!.pun.via)?.targetName ?? '');
  }
  if (sim.storeAfterPoisonRead) {
    involvedNames.add(sim.storeAfterPoisonRead.destVar.name);
  }
  if (op?.kind === 'write') {
    const ptr = sim.punPointers.find(p => p.ptrName === op.name);
    if (ptr) {
      involvedNames.add(ptr.ptrName);
      involvedNames.add(ptr.targetName);
    }
  }

  // 1. Shared byte-accurate memory strip
  const mem = renderByteMemory(c, {
    padId,
    ubId,
    minEndAddress: sim.endAddress,
    paddingByte(addr) {
      const slot = sim.bytes[addr - sim.baseAddress];
      if (!slot || !slot.corrupted) return null;
      const revealAt =
        isPunWrite && sim.activePun
          ? at + 0.08 * Math.max(0, addr - sim.activePun.targetAddress)
          : at;
      return {
        value: slot.after,
        beforeValue: slot.before,
        corrupted: true,
        corruptedBefore: slot.corruptedBefore,
        corruptedNow: slot.corruptedNow,
        revealAt,
      };
    },
    stateOf(leaf): ByteVariableState {
      const beforeDec = sim.varBefore.get(leaf.name) ?? null;
      const afterDec = sim.varAfter.get(leaf.name) ?? null;
      // Undeclared variables stay dark and empty until declared, even if an OOB write touched their slot.
      if (afterDec === null) {
        return {
          beforeHeader: null,
          afterHeader: null,
          bytes: [],
          changing: false,
          corrupted: false,
          corruptedNow: false,
          keepBright: false,
          suppressDefaultHighlight: Boolean(isPunWrite || isPunRead),
        };
      }
      const isCorrupted = sim.corruptedVars.has(leaf.name);
      const isDestTileStore = Boolean(
        byteTileStore &&
          (sim.storeAfterPunRead?.destVar.name === leaf.name ||
            sim.storeAfterPoisonRead?.destVar.name === leaf.name)
      );
      const isNormalWrite = Boolean(op?.kind === 'write' && op.name === leaf.name && !isPunWrite && !isDestTileStore);
      const changing = Boolean(
        isNormalWrite ||
          isDestTileStore ||
          (isPunWrite &&
            sim.activePun &&
            leaf.address < sim.activePun.targetAddress + sim.activePun.pun.size &&
            leaf.address + leaf.size > sim.activePun.targetAddress)
      );
      const allUnknown = afterDec.text === '?' && !afterDec.poisoned;
      let corruptedNow = false;
      const bytes: ByteCellState[] = [];
      for (let k = 0; k < leaf.size; k++) {
        const addr = leaf.address + k;
        const slot = sim.bytes[addr - sim.baseAddress];
        if (!slot) continue;
        if (slot.corruptedNow) corruptedNow = true;
        const revealAt = isPunWrite && sim.activePun
          ? at + 0.08 * Math.max(0, addr - sim.activePun.targetAddress)
          : isDestTileStore
            ? at + 0.08 * k
            : at;
        bytes.push({
          before: slot.before,
          after: slot.after,
          corrupted: slot.corrupted,
          corruptedNow: slot.corruptedNow,
          poisoned: !allUnknown && slot.after === '?',
          revealAt,
        });
      }
      const keepBright =
        isCorrupted ||
        (Boolean(isPunRead) && sim.readForeignVars.has(leaf.name)) ||
        involvedNames.has(leaf.name);
      return {
        beforeHeader: beforeDec ? { text: beforeDec.text, poisoned: beforeDec.poisoned } : null,
        afterHeader: { text: afterDec.text, poisoned: afterDec.poisoned },
        bytes,
        changing,
        corrupted: isCorrupted,
        corruptedNow,
        keepBright,
        suppressDefaultHighlight: Boolean(isPunWrite || isPunRead || isPoisonRead),
      };
    },
  });

  // 2. Transient full-height read/write highlight on the exact punned or uninitialized byte span
  let accessFlash = '';
  if (animate && sim.activePun && (isPunWrite || isPunRead)) {
    const { targetAddress, targetSize, pun, direction } = sim.activePun;
    const startPos = posOf(targetAddress);
    const wLeft = startPos.x;
    const rowY = startPos.y;
    const wWidth = pun.size * byteW;
    const ownW = targetSize * byteW;
    const spillW = wWidth - ownW;
    if (isPunWrite) {
      if (direction === 'larger') {
        accessFlash += transientWriteHighlight(wLeft, rowY, ownW, cellH, P.write, at);
        if (spillW > 0) accessFlash += transientWriteHighlight(wLeft + ownW, rowY, spillW, cellH, P.error, at + 0.08);
      } else {
        accessFlash += transientWriteHighlight(wLeft, rowY, wWidth, cellH, P.write, at);
      }
    } else if (isPunRead) {
      if (direction === 'larger') {
        accessFlash += transientReadHighlight(wLeft, rowY, ownW, cellH, P.read, at);
        if (spillW > 0) accessFlash += transientReadHighlight(wLeft + ownW, rowY, spillW, cellH, P.error, at);
      } else {
        accessFlash += transientReadHighlight(wLeft, rowY, wWidth, cellH, P.read, at);
      }
    }
  } else if (animate && sim.activePoisonRead) {
    const { address, size, bytes } = sim.activePoisonRead;
    if (bytes.every(b => b === '?')) {
      const p = posOf(address);
      accessFlash += transientReadHighlight(p.x, p.y, size * byteW, cellH, P.error, at);
    } else {
      for (let k = 0; k < size; k++) {
        const col = bytes[k] === '?' ? P.error : P.read;
        const p = posOf(address + k);
        accessFlash += transientReadHighlight(p.x, p.y, byteW, cellH, col, at);
      }
    }
  }

  // 3. Clean overhead pointer arcs
  const arcMarkup = punningArrows(c, sim, posOf, byteW);

  // 4. Full-height open HUD corner reticles
  let scopeReticles = '';
  for (const ptr of sim.punPointers) {
    const ptrLeaf = g.leaves.find(l => l.name === ptr.ptrName);
    if (!ptrLeaf) continue;
    scopeReticles += punReticle(c, sim, ptr, posOf, byteW, cellH, ptrLeaf.color);
  }

  // 5. UB bracket & `⚠ UB` badge below memory — on larger-pointer access or uninitialized read
  let belowOverlay = '';
  const rowTypeBottom = (rowY: number): number => {
    const rowNames = new Set(g.leaves.filter(l => Math.abs(l.y - rowY) < 1).map(l => l.name));
    const rowLabels = g.typeLabels.filter(l => rowNames.has(l.name));
    return rowLabels.length
      ? Math.max(...rowLabels.map(l => l.top + LABEL.memory + 7))
      : rowY + cellH + 40;
  };
  const punUbCovered = new Set<string>();
  for (const ptr of sim.punPointers) {
    if (ptr.direction !== 'larger' || ptr.ubKind === 'none') continue;
    punUbCovered.add(ptr.targetName);
    const startPos = posOf(ptr.targetAddress);
    const wLeft = startPos.x;
    const wRight = wLeft + ptr.pointeeSize * byteW;
    const ownEnd = wLeft + ptr.targetSize * byteW;
    const brY = rowTypeBottom(startPos.y) + 16;
    const tickTop = brY - 10;
    const ownCol = ptr.ubKind === 'read' ? P.read : P.write;
    const cal =
      `<g class="cv-ub-badge" data-ptr="${ptr.ptrName}">` +
      `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(ownEnd)}" fill="none" stroke="${ownCol}" stroke-width="2.2"/>` +
      `<path d="M ${round(ownEnd)} ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.error}" stroke-width="2.8"/>` +
      pill((ownEnd + wRight) / 2, brY + 18, '⚠ UB', 13.5, P.error, P.error, P.bg) +
      '</g>';
    const triggersNow =
      animate &&
      ptr.ubTriggeredNow &&
      ((isPunRead && sim.activePun?.pun.via === ptr.ptrName) ||
        (isPunWrite && sim.activePun?.pun.via === ptr.ptrName));
    const showAt = isPunRead ? dep : at;
    belowOverlay += triggersNow ? `<g opacity="0">${fade(0, 1, 0.25, showAt)}${cal}</g>` : cal;
  }
  for (const varName of sim.uninitUbVars) {
    if (punUbCovered.has(varName)) continue;
    const leaf = g.leaves.find(l => l.name === varName);
    if (!leaf) continue;
    const startPos = posOf(leaf.address);
    const wLeft = startPos.x;
    const wRight = wLeft + leaf.size * byteW;
    const brY = rowTypeBottom(startPos.y) + 16;
    const tickTop = brY - 10;
    const cal =
      `<g class="cv-ub-badge" data-var="${leaf.name}">` +
      `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.error}" stroke-width="2.8"/>` +
      pill((wLeft + wRight) / 2, brY + 18, '⚠ UB', 13.5, P.error, P.error, P.bg) +
      '</g>';
    const triggersNow = animate && sim.uninitUbTriggeredNow.has(varName) && sim.activePoisonRead?.varName === varName;
    belowOverlay += triggersNow ? `<g opacity="0">${fade(0, 1, 0.25, dep)}${cal}</g>` : cal;
  }

  // 6. Standardized pane byte strip & bidirectional byte-tile flights
  let wb = '';
  let flight = '';
  const stripSource =
    isPunWrite || isPunRead
      ? {
          bytes: sim.activePun!.bytes,
          targetAddress: sim.activePun!.targetAddress,
          targetSize: sim.activePun!.targetSize,
          direction: sim.activePun!.direction,
          destVar: null,
          mode: isPunRead ? ('read' as const) : ('write' as const),
        }
      : isPoisonRead && sim.activePoisonRead
        ? {
            bytes: sim.activePoisonRead.bytes,
            targetAddress: sim.activePoisonRead.address,
            targetSize: sim.activePoisonRead.size,
            direction: 'same' as const,
            destVar: null,
            mode: 'read' as const,
          }
        : byteTileStore && sim.storeAfterPunRead
          ? {
              bytes: sim.storeAfterPunRead.bytes,
              targetAddress: sim.storeAfterPunRead.targetAddress,
              targetSize: sim.storeAfterPunRead.targetSize,
              direction: sim.storeAfterPunRead.direction,
              destVar: sim.storeAfterPunRead.destVar,
              mode: 'store' as const,
            }
          : byteTileStore && sim.storeAfterPoisonRead
            ? {
                bytes: sim.storeAfterPoisonRead.bytes,
                targetAddress: sim.storeAfterPoisonRead.sourceAddress,
                targetSize: sim.storeAfterPoisonRead.sourceSize,
                direction: 'same' as const,
                destVar: sim.storeAfterPoisonRead.destVar,
                mode: 'store' as const,
              }
            : null;

  if (stripSource) {
    const stripY = g.ty + 28;
    const tileW = 44;
    const tileH = 30;
    const tileGap = 6;
    const slotCount =
      stripSource.direction === 'smaller'
        ? Math.max(stripSource.bytes.length, stripSource.targetSize)
        : stripSource.bytes.length;
    const stripW = slotCount * tileW + Math.max(0, slotCount - 1) * tileGap;
    const stepOp = step.op;
    const rhsStart =
      stepOp && 'span' in stepOp
        ? stepOp.span[0]
        : Math.max(0, step.pane.indexOf('= ') + 2);
    const tilesX = Math.max(
      g.pane.x + 12,
      Math.min(g.tx + rhsStart * g.paneChar, g.pane.x + g.pane.w - 12 - stripW)
    );
    const count = stripSource.bytes.length;
    const readStagger = count > 1 ? Math.min(0.08, 0.3 / (count - 1)) : 0;
    const readDur = Math.max(0.45, Math.min(0.85, at - dep - readStagger * Math.max(0, count - 1)));

    for (let k = 0; k < count; k++) {
      const addr = stripSource.targetAddress + k;
      const slot = sim.bytes[addr - sim.baseAddress];
      const bval = stripSource.bytes[k];
      const label = typeof bval === 'number' ? hexByte(bval) : '??';
      const isOobSlot = slot && (slot.status === 'padding' || slot.status === 'foreign');
      const isBad =
        stripSource.mode === 'store'
          ? bval === '?' || (stripSource.direction === 'larger' && Boolean(isOobSlot))
          : Boolean(isOobSlot) || bval === '?';
      const tx = tilesX + k * (tileW + tileGap);
      const isReadPhase = stripSource.mode === 'read';
      const baseStroke = isReadPhase ? P.read : P.write;
      const baseFill = isReadPhase ? P.readFill : P.writeFill;
      const stroke = isBad ? P.error : baseStroke;
      const fill = isBad ? P.panel : baseFill;
      const tileMarkup =
        rect(tx, stripY, tileW, tileH, fill, stroke, 5, 2) +
        text(tx + tileW / 2, stripY + 20, label, 15.5, stroke, 'middle');

      if (animate && stripSource.mode === 'read') {
        const sp = posOf(addr);
        const sx = sp.x + byteW / 2;
        const sy = sp.y + 70;
        const ex = tx + tileW / 2;
        const ey = stripY + tileH / 2;
        const midY = (sy + ey) / 2;
        const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
        const begin = dep + k * readStagger;
        const end = begin + readDur;
        const flyCol = isOobSlot || bval === '?' ? P.error : P.read;
        wb += `<g opacity="0">${show(end)}${tileMarkup}</g>`;
        flight +=
          `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${flyCol}" stroke-width="2.4"/></g>` +
          `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
          rect(-20, -14, 40, 28, P.panel, flyCol, 6, 2) +
          text(0, 6, label, 15, flyCol, 'middle') +
          `<animateMotion begin="${round(begin)}s" dur="${round(readDur)}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
      } else {
        wb += tileMarkup;
        if (animate && stripSource.mode === 'write') {
          const ep = posOf(addr);
          const sx = tx + tileW / 2;
          const sy = stripY;
          const ex = ep.x + byteW / 2;
          const ey = ep.y + 70;
          const midY = (sy + ey) / 2;
          const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
          const dur = 0.85;
          const end = at + k * 0.08;
          const begin = Math.max(0.2, end - dur);
          const flyCol = isOobSlot ? P.error : P.write;
          flight +=
            `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${flyCol}" stroke-width="2.4"/></g>` +
            `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
            rect(-20, -14, 40, 28, P.panel, flyCol, 6, 2) +
            text(0, 6, label, 15, flyCol, 'middle') +
            `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        } else if (animate && stripSource.mode === 'store' && stripSource.destVar) {
          const ep = posOf(stripSource.destVar.address + k);
          const sx = tx + tileW / 2;
          const sy = stripY;
          const ex = ep.x + byteW / 2;
          const ey = ep.y + 70;
          const midY = (sy + ey) / 2;
          const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
          const dur = 0.85;
          const end = at + k * 0.08;
          const begin = Math.max(0.2, end - dur);
          flight +=
            `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.4"/></g>` +
            `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
            rect(-20, -14, 40, 28, P.panel, stroke, 6, 2) +
            text(0, 6, label, 15, stroke, 'middle') +
            `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        }
      }
    }

    if (stripSource.direction === 'smaller') {
      let slots = '';
      for (let k = stripSource.bytes.length; k < stripSource.targetSize; k++) {
        const tx = tilesX + k * (tileW + tileGap);
        slots += `<rect x="${round(tx)}" y="${stripY}" width="${tileW}" height="${tileH}" rx="5" fill="none" stroke="${P.grey}" stroke-opacity="0.75" stroke-dasharray="4 3" stroke-width="1.6"/>`;
      }
      wb +=
        animate && stripSource.mode === 'read'
          ? `<g opacity="0">${fade(0, 1, 0.2, dep + 0.65)}${slots}</g>`
          : slots;
    }
  }

  const paneMarkup = colorPoisonHexInSvg(pane(c, animate && copies(c.m.steps, c.index)), P.error);
  const outputMarkup = colorPoisonHexInSvg(output(c), P.error);
  const transferMarkup =
    !animate || isPunWrite || isPunRead || isPoisonRead || byteTileStore
      ? ''
      : colorPoisonHexInSvg(transfers(c), P.error);

  return (
    defs +
    code(c, oldLine) +
    tether(c, oldLine) +
    arcMarkup +
    mem +
    accessFlash +
    scopeReticles +
    belowOverlay +
    paneMarkup +
    wb +
    outputMarkup +
    transferMarkup +
    flight
  );
}

export const PUNNING_VIEW: TraceView = {
  geometry(m) {
    return {
      minByteWidth: 46,
      minColumnWidth: 540,
      cellHeight: BYTE_CELL_HEIGHT,
      extraMemBottom: hasLargerPointerAccess(m.trace) || hasUninitializedRead(m.trace) ? 58 : 12,
      extraPaneHeight: 46,
      flush: true,
      minEndAddress: punningMinEndAddress(m.trace),
    };
  },
  stackBelow: 900,
  maxScale: 0.72,
  byteOrder: true,
  resolveContext(c) {
    const sim = simulatePunningTrace(c.m.trace, c.index, c.littleEndian);
    return resolveEndianContext(c, sim);
  },
  scene: punningScene,
  stepSeconds: punningStepSeconds,
};
