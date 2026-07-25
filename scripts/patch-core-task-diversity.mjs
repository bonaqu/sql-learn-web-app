import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/data/course.ts';
const source = readFileSync(path, 'utf8');
const before = `  'sql-thinking': v => ({
    title: \`Контракт результата: \${services[v % services.length]}\`,
    description: \`Покажи ticket_id, service и status для сервиса \${services[v % services.length]}. Результат должен быть стабильно отсортирован.\`,
    starter: 'SELECT\\n  ticket_id,\\n  service,\\n  status\\nFROM tickets\\nWHERE ',
    solution: \`SELECT ticket_id, service, status FROM tickets WHERE service = '\${services[v % services.length]}' ORDER BY ticket_id;\`,
    hints: ['Сначала сформулируй одну строку результата.', \`Фильтр сравнивает service со строкой '\${services[v % services.length]}'.\`, 'Добавь ORDER BY ticket_id.']
  }),`;
const after = `  'sql-thinking': v => v === 5 ? ({
    title: 'Контракт результата: Critical обращения',
    description: 'Покажи ticket_id, service и status для всех Critical-обращений независимо от сервиса. Результат должен быть стабильно отсортирован.',
    starter: 'SELECT\\n  ticket_id,\\n  service,\\n  status\\nFROM tickets\\nWHERE ',
    solution: "SELECT ticket_id, service, status FROM tickets WHERE priority = 'Critical' ORDER BY ticket_id;",
    hints: ['Одна строка результата — одно обращение.', "Фильтр сравнивает priority со строкой 'Critical'.", 'Добавь ORDER BY ticket_id.']
  }) : ({
    title: \`Контракт результата: \${services[v % services.length]}\`,
    description: \`Покажи ticket_id, service и status для сервиса \${services[v % services.length]}. Результат должен быть стабильно отсортирован.\`,
    starter: 'SELECT\\n  ticket_id,\\n  service,\\n  status\\nFROM tickets\\nWHERE ',
    solution: \`SELECT ticket_id, service, status FROM tickets WHERE service = '\${services[v % services.length]}' ORDER BY ticket_id;\`,
    hints: ['Сначала сформулируй одну строку результата.', \`Фильтр сравнивает service со строкой '\${services[v % services.length]}'.\`, 'Добавь ORDER BY ticket_id.']
  }),`;
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`Expected one sql-thinking recipe, got ${count}`);
writeFileSync(path, source.replace(before, after));
