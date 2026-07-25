import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/data/course.ts';
const source = readFileSync(path, 'utf8');
const before = `  indexes: v => ({
    title: \`План поиска \${services[v % services.length]}\`,
    description: \`Проверь план поиска обращений сервиса \${services[v % services.length]}. Индекс по service уже создан.\`,
    starter: 'EXPLAIN QUERY PLAN\\nSELECT ticket_id, service\\nFROM tickets\\nWHERE ',
    solution: \`EXPLAIN QUERY PLAN SELECT ticket_id, service FROM tickets WHERE service = '\${services[v % services.length]}';\`,
    hints: ['Запрос начинается с EXPLAIN QUERY PLAN.', \`Фильтр: service = '\${services[v % services.length]}'.\`, 'В результате ожидается SEARCH с индексом.']
  }),`;
const after = `  indexes: v => v === 5 ? ({
    title: 'План составного фильтра Critical + Closed',
    description: 'Проверь план поиска закрытых Critical-обращений. Составной индекс по priority и status уже создан.',
    starter: 'EXPLAIN QUERY PLAN\\nSELECT ticket_id, priority, status\\nFROM tickets\\nWHERE ',
    solution: "EXPLAIN QUERY PLAN SELECT ticket_id, priority, status FROM tickets WHERE priority = 'Critical' AND status = 'Closed';",
    hints: ['Запрос начинается с EXPLAIN QUERY PLAN.', "Фильтр использует priority = 'Critical' и status = 'Closed'.", 'В результате ожидается SEARCH по составному индексу.']
  }) : ({
    title: \`План поиска \${services[v % services.length]}\`,
    description: \`Проверь план поиска обращений сервиса \${services[v % services.length]}. Индекс по service уже создан.\`,
    starter: 'EXPLAIN QUERY PLAN\\nSELECT ticket_id, service\\nFROM tickets\\nWHERE ',
    solution: \`EXPLAIN QUERY PLAN SELECT ticket_id, service FROM tickets WHERE service = '\${services[v % services.length]}';\`,
    hints: ['Запрос начинается с EXPLAIN QUERY PLAN.', \`Фильтр: service = '\${services[v % services.length]}'.\`, 'В результате ожидается SEARCH с индексом.']
  }),`;
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`Expected one indexes recipe, got ${count}`);
writeFileSync(path, source.replace(before, after));
