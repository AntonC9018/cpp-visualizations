#!/usr/bin/env node
// CLI entrypoint for generating manual pointer and struct trace fixtures.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIXTURES,
  TRACES,
  adjacent_copy,
  arrow_operator,
  copy_assignment,
  copy_through_pointer,
  double_pointer,
  field_address,
  reassign,
  render,
  shallow_copy,
  shared_target,
  writeFixtures,
  write_through,
} from '../src/node/fixtures.ts';

export {
  FIXTURES,
  TRACES,
  adjacent_copy,
  arrow_operator,
  copy_assignment,
  copy_through_pointer,
  double_pointer,
  field_address,
  reassign,
  render,
  shallow_copy,
  shared_target,
  writeFixtures,
  write_through,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFixtures();
}
