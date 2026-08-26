#!/usr/bin/env node
import { buildProgram } from '../src/program.js';

buildProgram().parseAsync(process.argv);
