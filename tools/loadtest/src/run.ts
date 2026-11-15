// Scenario runner: `npm run loadtest -w @orbitops/loadtest -- --scenario B`
//   --scenario A|B|C|D|E|F|all   which scenario(s) to run (default all)
//   --duration 30                measured window in seconds
//   --clients N                  override the viewer count of A, B and D
//   --suffix -10k                appended to the result file name (e.g. D-10k.json)
//   --port 4020                  port of the spawned server
//   --no-spawn --url U --pid P   use a running server instead (its limits cannot be changed by the runner)
import { numberFlag, parseFlags, stringFlag } from './args.js';
import { machineInfo, markdownTable, writeMachine, writeResult } from './report.js';
import type { RunSettings } from './scenarioKit.js';
import { SCENARIOS, type ScenarioResult } from './scenarios.js';

const flags = parseFlags();
const wanted = stringFlag(flags, 'scenario', 'all').toUpperCase();
const selected = wanted === 'ALL' ? SCENARIOS : SCENARIOS.filter((s) => s.id === wanted);
if (selected.length === 0) {
  throw new Error(
    `unknown scenario "${wanted}"; use ${SCENARIOS.map((s) => s.id).join(', ')} or all`,
  );
}

const settings: RunSettings = {
  port: numberFlag(flags, 'port', 4020),
  durationS: numberFlag(flags, 'duration', 30),
  ...(typeof flags.clients === 'string' ? { clients: numberFlag(flags, 'clients', 0) } : {}),
  ...(flags['no-spawn'] === true
    ? {
        external: {
          url: stringFlag(flags, 'url', 'http://localhost:4000'),
          pid: numberFlag(flags, 'pid', 0),
        },
      }
    : {}),
};
if (settings.external && settings.external.pid === 0) {
  throw new Error('--no-spawn needs --pid <server pid> so server CPU can be read from /proc');
}

await writeMachine();
console.log('Machine:', JSON.stringify(machineInfo()));

const results: ScenarioResult[] = [];
for (const scenario of selected) {
  console.log(`\n=== Scenario ${scenario.id}: ${scenario.title} ===`);
  const result = await scenario.run(settings);
  const file = await writeResult(result, stringFlag(flags, 'suffix', ''));
  console.log(`${result.description}\nwritten ${file}`);
  results.push(result);
}

console.log(`\n${markdownTable(results)}`);
process.exit(0);
