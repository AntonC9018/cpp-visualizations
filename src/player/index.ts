/* Course visualization player entrypoint.
 *
 * Steps through traces in the unified format (see README.md): source code on the left, memory
 * with pointer arcs and struct frames above an expression-evaluation pane on the right, and the
 * program output below. Every `div.course-visualization` holding a
 * `<script type="application/json">` trace becomes a player, lazily, once its `<details>` opens.
 */
import type { AnyTrace } from '../core/trace_format.ts';
import { strings } from './constants.ts';
import { Layout } from './layout_view.ts';
import { Player } from './player_view.ts';

export type VisualizationInstance = Player | Layout;

export interface VisualizationHost extends HTMLDivElement {
  cvPlayer?: VisualizationInstance;
}

export interface CourseVisualizationGlobal {
  version: number;
  players: VisualizationInstance[];
  scan(root?: ParentNode): void;
}

declare global {
  interface Window {
    CourseVisualization?: CourseVisualizationGlobal;
  }
}

function setupCourseVisualization(): void {
  if (typeof window === 'undefined' || window.CourseVisualization) return;

  const players: VisualizationInstance[] = [];

  const closedAncestor = (element: Element): Element | null =>
    element.parentElement && element.parentElement.closest('details:not([open])');

  function initialize(host: VisualizationHost): void {
    if (host.dataset.cvState === 'ready' || host.dataset.cvState === 'error') return;
    try {
      const data = host.querySelector('script[type="application/json"]');
      const trace = JSON.parse(data?.textContent ?? '') as AnyTrace;
      const player: VisualizationInstance =
        trace.kind === 'layout' ? new Layout(host, trace) : new Player(host, trace);
      host.dataset.cvState = 'ready';
      host.cvPlayer = player;
      players.push(player);
    } catch (error) {
      host.dataset.cvState = 'error';
      const message = document.createElement('p');
      message.className = 'cv-error';
      message.textContent = strings().error;
      host.append(message);
      console.error('course visualization:', error);
    }
  }

  function scan(root: ParentNode = document): void {
    for (let i = players.length - 1; i >= 0; i--) {
      if (!players[i].host.isConnected) {
        players[i].disconnect();
        players.splice(i, 1);
      }
    }
    for (const host of root.querySelectorAll<VisualizationHost>('div.course-visualization')) {
      if (!host.dataset.cvState) host.dataset.cvState = 'waiting';
      if (host.dataset.cvState === 'waiting' && !closedAncestor(host)) initialize(host);
    }
  }

  document.addEventListener(
    'toggle',
    event => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      if (!details.open) {
        for (const player of players) {
          if (details.contains(player.host)) player.pause();
        }
        return;
      }
      scan(details);
      for (const player of players) {
        if (player.stale && !closedAncestor(player.host)) {
          player.stale = false;
          player.refresh();
        }
      }
    },
    true
  );

  const restyle = (): void => {
    for (const player of players) {
      if (closedAncestor(player.host)) player.stale = true;
      else player.refresh();
    }
  };

  new MutationObserver(restyle).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', restyle);
  }
  document.addEventListener('astro:page-load', () => scan());

  window.CourseVisualization = { version: 1, players, scan };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }
}

setupCourseVisualization();
