#!/usr/bin/env node
import { run } from "../dist/index.js";

const { exitCode, stdout, stderr } = await run(process.argv.slice(2));
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = exitCode;
