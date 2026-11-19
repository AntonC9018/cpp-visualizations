// Pieces of C++ lexing the tracer needs before Clang has read the source.

/**
 * A raw string literal, `R"(…)"` or `R"tag(…)tag"`: its content runs to the matching delimiter,
 * whatever it holds. The tag is the pattern's only capture group, so a regular expression that
 * includes it must have no capture group before it.
 */
export const RAW_STRING = String.raw`(?:u8|[uUL])?R"([^()\\\s]{0,16})\([\s\S]*?\)\1"`;

/** A line splice: a backslash, then the end of the line, as Clang ends it. */
export const LINE_SPLICE = /\\[ \t\f\v]*(?:\r\n?|\n)/;
