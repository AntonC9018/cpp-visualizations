// The playground's examples, each with the settings a lesson tag would trace it with.
import type { Localized, TraceSettings } from '../core/settings.ts';

export interface PlaygroundPreset {
  id: string;
  settings: TraceSettings;
  label: Localized;
  source: string;
}

export const PRESETS: readonly PlaygroundPreset[] = [
  {
    id: 'double-pointer',
    settings: { template: 'expression-timeline', flags: {} },
    label: { en: 'Double pointer (**pp)', ru: 'Указатель на указатель (**pp)' },
    source: [
      'int a = 5;',
      'int b = 6;',
      'int* p = &a;',
      'int** pp = &p;',
      '**pp = 7;',
      'std::cout << a << std::endl;',
    ].join('\n'),
  },
  {
    id: 'struct-shallow-copy',
    settings: { template: 'expression-timeline', flags: {} },
    label: { en: 'Struct & shallow pointer copy', ru: 'Структура и поверхностное копирование' },
    source: [
      'struct S {',
      '  int x;',
      '  int* p;',
      '};',
      'int a = 1;',
      'S s{2, &a};',
      'S t = s;',
      'S* ptr = &s;',
      'ptr->x = 3;',
      '*t.p = 7;',
      'std::cout << s.x << std::endl;',
    ].join('\n'),
  },
  {
    id: 'references',
    settings: { template: 'expression-timeline', flags: {} },
    label: { en: 'References as aliases', ru: 'Ссылки как псевдонимы' },
    source: [
      'int a = 10;',
      'int& ref = a;',
      'ref = 25;',
      'int* p = &ref;',
      '*p = 42;',
      'std::cout << a << std::endl;',
    ].join('\n'),
  },
  {
    id: 'nested-struct',
    settings: { template: 'expression-timeline', flags: {} },
    label: { en: 'Nested struct & designated init', ru: 'Вложенная структура и поля' },
    source: [
      'struct N { int f; int g; };',
      'struct A { int* p; N n; int f; };',
      'int v = 1;',
      'A a{ .p = &v, .n = { .f = 2 } };',
      'A b{a};',
      'N* q = &b.n;',
      'q->g = 9;',
      'int* r = &a.n.f;',
      '*r = 4;',
      'std::cout << b.n.g << std::endl;',
    ].join('\n'),
  },
  {
    id: 'type-mismatch',
    settings: { template: 'expression-timeline', flags: { types: true } },
    label: { en: 'Conversions & mismatched types', ru: 'Преобразования и несовместимые типы' },
    source: ['uint8_t a = 200;', 'int b = a + a;', 'int* p = b;'].join('\n'),
  },
  {
    id: 'layout-padding',
    settings: { template: 'layout', flags: {} },
    label: { en: 'Struct padding & alignment', ru: 'Выравнивание и заполнение полей' },
    source: [
      'struct Packet {',
      '  uint8_t tag;',
      '  int value;',
      '  uint8_t flags;',
      '};',
    ].join('\n'),
  },
  {
    id: 'layout-pointers',
    settings: { template: 'layout', flags: {} },
    label: { en: '64-bit pointer fields layout', ru: 'Раскладка полей с указателями' },
    source: [
      'struct Node {',
      '  int8_t kind;',
      '  int* next;',
      '  size_t count;',
      '  uint64_t id;',
      '};',
    ].join('\n'),
  },
];
