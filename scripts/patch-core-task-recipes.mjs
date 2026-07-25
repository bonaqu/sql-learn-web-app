import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/data/course.ts';
let source = readFileSync(path, 'utf8');
function patch(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  source = source.replace(before, after);
}

patch(`  sorting: v => ({
    title: \`Топ-\${(v % 3) + 2} долгих обращений\`,
    description: \`Покажи \${(v % 3) + 2} закрытых обращения с самым большим временем решения. При равенстве выше должен быть меньший ticket_id.\`,
    starter: 'SELECT ticket_id, resolution_minutes\\nFROM tickets\\nWHERE resolution_minutes IS NOT NULL\\nORDER BY ',
    solution: \`SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY resolution_minutes DESC, ticket_id ASC LIMIT \${(v % 3) + 2};\`,
    hints: ['Главная сортировка — resolution_minutes DESC.', 'ticket_id нужен как tie-breaker.', 'LIMIT ставится после ORDER BY.']
  }),`, `  sorting: v => v < 3 ? ({
    title: \`Топ-\${(v % 3) + 2} долгих обращений\`,
    description: \`Покажи \${(v % 3) + 2} закрытых обращения с самым большим временем решения. При равенстве выше должен быть меньший ticket_id.\`,
    starter: 'SELECT ticket_id, resolution_minutes\\nFROM tickets\\nWHERE resolution_minutes IS NOT NULL\\nORDER BY ',
    solution: \`SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY resolution_minutes DESC, ticket_id ASC LIMIT \${(v % 3) + 2};\`,
    hints: ['Главная сортировка — resolution_minutes DESC.', 'ticket_id нужен как tie-breaker.', 'LIMIT ставится после ORDER BY.']
  }) : ({
    title: \`Топ-\${(v % 3) + 2} быстрых обращений\`,
    description: \`Покажи \${(v % 3) + 2} закрытых обращения с самым маленьким временем решения. При равенстве выше должен быть меньший ticket_id.\`,
    starter: 'SELECT ticket_id, resolution_minutes\\nFROM tickets\\nWHERE resolution_minutes IS NOT NULL\\nORDER BY ',
    solution: \`SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY resolution_minutes ASC, ticket_id ASC LIMIT \${(v % 3) + 2};\`,
    hints: ['Главная сортировка — resolution_minutes ASC.', 'ticket_id нужен как tie-breaker.', 'LIMIT ставится после ORDER BY.']
  }),`, 'sorting recipe');

patch(`  grouping: v => ({
    title: \`Сервисы минимум с \${(v % 3) + 1} обращениями\`,
    description: \`Посчитай обращения по сервисам и оставь группы, где не меньше \${(v % 3) + 1} строк.\`,
    starter: 'SELECT service, COUNT(*) AS tickets_count\\nFROM tickets\\nGROUP BY service\\nHAVING ',
    solution: \`SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service HAVING COUNT(*) >= \${(v % 3) + 1} ORDER BY tickets_count DESC, service;\`,
    hints: ['COUNT(*) фильтруется через HAVING.', \`Порог: >= \${(v % 3) + 1}.\`, 'Сортируй по псевдониму и service.']
  }),`, `  grouping: v => v < 3 ? ({
    title: \`Сервисы минимум с \${(v % 3) + 1} обращениями\`,
    description: \`Посчитай обращения по сервисам и оставь группы, где не меньше \${(v % 3) + 1} строк.\`,
    starter: 'SELECT service, COUNT(*) AS tickets_count\\nFROM tickets\\nGROUP BY service\\nHAVING ',
    solution: \`SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service HAVING COUNT(*) >= \${(v % 3) + 1} ORDER BY tickets_count DESC, service;\`,
    hints: ['COUNT(*) фильтруется через HAVING.', \`Порог: >= \${(v % 3) + 1}.\`, 'Сортируй по псевдониму и service.']
  }) : ({
    title: \`Приоритеты минимум с \${(v % 3) + 1} обращениями\`,
    description: \`Посчитай обращения по приоритетам и оставь группы, где не меньше \${(v % 3) + 1} строк.\`,
    starter: 'SELECT priority, COUNT(*) AS tickets_count\\nFROM tickets\\nGROUP BY priority\\nHAVING ',
    solution: \`SELECT priority, COUNT(*) AS tickets_count FROM tickets GROUP BY priority HAVING COUNT(*) >= \${(v % 3) + 1} ORDER BY tickets_count DESC, priority;\`,
    hints: ['COUNT(*) фильтруется через HAVING.', \`Порог: >= \${(v % 3) + 1}.\`, 'Сортируй по псевдониму и priority.']
  }),`, 'grouping recipe');

patch(`  subqueries: v => ({
    title: \`Выше среднего по \${priorities[v % priorities.length]}\`,
    description: \`Найди закрытые обращения приоритета \${priorities[v % priorities.length]}, которые решались дольше среднего среди закрытых обращений того же приоритета.\`,
    starter: 'SELECT ticket_id, priority, resolution_minutes\\nFROM tickets\\nWHERE priority = ',
    solution: \`SELECT ticket_id, priority, resolution_minutes FROM tickets WHERE priority = '\${priorities[v % priorities.length]}' AND resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE priority = '\${priorities[v % priorities.length]}' AND resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC, ticket_id;\`,
    hints: ['Подзапрос должен вернуть одно среднее.', 'Внутри и снаружи используй одинаковый priority.', 'NULL не должен участвовать в AVG.']
  }),`, `  subqueries: v => v < 4 ? ({
    title: \`Выше среднего по \${priorities[v % priorities.length]}\`,
    description: \`Найди закрытые обращения приоритета \${priorities[v % priorities.length]}, которые решались дольше среднего среди закрытых обращений того же приоритета.\`,
    starter: 'SELECT ticket_id, priority, resolution_minutes\\nFROM tickets\\nWHERE priority = ',
    solution: \`SELECT ticket_id, priority, resolution_minutes FROM tickets WHERE priority = '\${priorities[v % priorities.length]}' AND resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE priority = '\${priorities[v % priorities.length]}' AND resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC, ticket_id;\`,
    hints: ['Подзапрос должен вернуть одно среднее.', 'Внутри и снаружи используй одинаковый priority.', 'NULL не должен участвовать в AVG.']
  }) : ({
    title: \`Выше среднего в сервисе \${services[(v - 4) * 3]}\`,
    description: \`Найди закрытые обращения сервиса \${services[(v - 4) * 3]}, которые решались дольше среднего среди закрытых обращений этого сервиса.\`,
    starter: 'SELECT ticket_id, service, resolution_minutes\\nFROM tickets\\nWHERE service = ',
    solution: \`SELECT ticket_id, service, resolution_minutes FROM tickets WHERE service = '\${services[(v - 4) * 3]}' AND resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE service = '\${services[(v - 4) * 3]}' AND resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC, ticket_id;\`,
    hints: ['Подзапрос должен вернуть одно среднее.', 'Внутри и снаружи используй одинаковый service.', 'NULL не должен участвовать в AVG.']
  }),`, 'subqueries recipe');

writeFileSync(path, source);
