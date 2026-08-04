import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type RecursiveCteEvidenceTag =
  | 'anchor-member'
  | 'termination-predicate'
  | 'bounded-sequence'
  | 'downward-hierarchy'
  | 'depth'
  | 'path'
  | 'ancestor-chain'
  | 'upward-traversal'
  | 'cycle-guard'
  | 'visited-path'
  | 'reachability'
  | 'minimum-hops'
  | 'path-count'
  | 'transitive-closure'
  | 'subtree-aggregation'
  | 'bill-of-materials'
  | 'quantity-propagation'
  | 'path-enumeration'
  | 'multiple-paths'
  | 'blast-radius'
  | 'dependency-closure'
  | 'depth-cap'
  | 'truncation-evidence';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-171': {
    title: 'Останови рекурсивную последовательность явным predicate',
    description: 'Сгенерируй ровно пять шагов через WITH RECURSIVE. Anchor создаёт первый шаг, recursive member уменьшает remaining, а WHERE обязан гарантировать конечность. Верни n и remaining, чтобы termination была наблюдаемой в данных.',
    starter: `WITH RECURSIVE steps(n, remaining) AS (
  VALUES (1, 5)
  UNION ALL
  SELECT n + 1, remaining - 1
  FROM steps
  WHERE
)
SELECT n, remaining
FROM steps
ORDER BY n;`,
    solution: `WITH RECURSIVE steps(n, remaining) AS (VALUES (1, 5) UNION ALL SELECT n + 1, remaining - 1 FROM steps WHERE remaining > 1) SELECT n, remaining FROM steps ORDER BY n;`,
    hints: [
      'Anchor member возвращает n = 1 и remaining = 5.',
      'Каждая рекурсивная итерация уменьшает remaining на единицу.',
      'WHERE remaining > 1 не создаёт строку после remaining = 1.'
    ]
  },
  'task-172': {
    title: 'Разверни иерархию вниз с depth и path',
    description: 'Начни с корневого подразделения и рекурсивно присоедини детей. Для каждой строки верни глубину и полный путь от Root. Путь должен строиться внутри recursive member, а не постфактум отдельными запросами.',
    starter: `CREATE TEMP TABLE org_nodes(
  node_id INTEGER PRIMARY KEY,
  parent_id INTEGER,
  name TEXT NOT NULL
);
INSERT INTO org_nodes VALUES
  (1, NULL, 'Root'),
  (2, 1, 'Support'), (3, 1, 'Data'),
  (4, 2, 'L1'), (5, 2, 'L2'),
  (6, 3, 'Analytics');

WITH RECURSIVE hierarchy(node_id, name, depth, path) AS (
  SELECT node_id, name, 0, name
  FROM org_nodes
  WHERE
  UNION ALL
  SELECT c.node_id, c.name,
         h.depth + 1,
         h.path || ' > ' || c.name
  FROM org_nodes c
  JOIN hierarchy h ON
)
SELECT node_id, name, depth, path
FROM hierarchy
ORDER BY depth, node_id;`,
    solution: `CREATE TEMP TABLE org_nodes(node_id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT NOT NULL); INSERT INTO org_nodes VALUES (1, NULL, 'Root'), (2, 1, 'Support'), (3, 1, 'Data'), (4, 2, 'L1'), (5, 2, 'L2'), (6, 3, 'Analytics'); WITH RECURSIVE hierarchy(node_id, name, depth, path) AS (SELECT node_id, name, 0, name FROM org_nodes WHERE node_id = 1 UNION ALL SELECT c.node_id, c.name, h.depth + 1, h.path || ' > ' || c.name FROM org_nodes c JOIN hierarchy h ON c.parent_id = h.node_id) SELECT node_id, name, depth, path FROM hierarchy ORDER BY depth, node_id;`,
    hints: [
      'Anchor выбирает только node_id = 1.',
      'Child присоединяется по c.parent_id = h.node_id.',
      'depth и path расширяются на каждом рекурсивном шаге.'
    ]
  },
  'task-173': {
    title: 'Подними ancestor chain от листа к корню',
    description: 'Для целевого узла Recursive CTE верни сам узел и всех предков до Company. Рекурсия движется по parent_id вверх; distance_to_target растёт, а path_up показывает порядок от листа к текущему предку.',
    starter: `CREATE TEMP TABLE category_nodes(
  node_id INTEGER PRIMARY KEY,
  parent_id INTEGER,
  name TEXT NOT NULL
);
INSERT INTO category_nodes VALUES
  (1, NULL, 'Company'),
  (2, 1, 'Education'),
  (3, 2, 'SQL'),
  (4, 3, 'Advanced'),
  (5, 4, 'Recursive CTE');

WITH RECURSIVE ancestors(node_id, parent_id, name, distance_to_target, path_up) AS (
  SELECT node_id, parent_id, name, 0, name
  FROM category_nodes
  WHERE
  UNION ALL
  SELECT p.node_id, p.parent_id, p.name,
         a.distance_to_target + 1,
         a.path_up || ' <- ' || p.name
  FROM ancestors a
  JOIN category_nodes p ON
)
SELECT node_id, name, distance_to_target, path_up
FROM ancestors
ORDER BY distance_to_target;`,
    solution: `CREATE TEMP TABLE category_nodes(node_id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT NOT NULL); INSERT INTO category_nodes VALUES (1, NULL, 'Company'), (2, 1, 'Education'), (3, 2, 'SQL'), (4, 3, 'Advanced'), (5, 4, 'Recursive CTE'); WITH RECURSIVE ancestors(node_id, parent_id, name, distance_to_target, path_up) AS (SELECT node_id, parent_id, name, 0, name FROM category_nodes WHERE node_id = 5 UNION ALL SELECT p.node_id, p.parent_id, p.name, a.distance_to_target + 1, a.path_up || ' <- ' || p.name FROM ancestors a JOIN category_nodes p ON p.node_id = a.parent_id) SELECT node_id, name, distance_to_target, path_up FROM ancestors ORDER BY distance_to_target;`,
    hints: [
      'Anchor — leaf node_id = 5.',
      'Следующий предок находится по p.node_id = a.parent_id.',
      'Рекурсия естественно заканчивается, когда parent_id корня равен NULL.'
    ]
  },
  'task-174': {
    title: 'Защити обход графа от цикла через visited path',
    description: 'Обойди граф от A, где C возвращается в A. Храни path с разделителями `|node|` и не переходи в уже посещённый узел текущего пути. Верни каждый достижимый узел, глубину и безопасный путь без бесконечной рекурсии.',
    starter: `CREATE TEMP TABLE graph_edges(from_node TEXT NOT NULL, to_node TEXT NOT NULL);
INSERT INTO graph_edges VALUES
  ('A', 'B'), ('B', 'C'), ('C', 'A'),
  ('B', 'D'), ('D', 'E');

WITH RECURSIVE walk(node, depth, visited_path, display_path) AS (
  VALUES ('A', 0, '|A|', 'A')
  UNION ALL
  SELECT e.to_node,
         w.depth + 1,
         w.visited_path || e.to_node || '|',
         w.display_path || ' > ' || e.to_node
  FROM walk w
  JOIN graph_edges e ON
  WHERE
)
SELECT node, depth, display_path
FROM walk
ORDER BY depth, node;`,
    solution: `CREATE TEMP TABLE graph_edges(from_node TEXT NOT NULL, to_node TEXT NOT NULL); INSERT INTO graph_edges VALUES ('A', 'B'), ('B', 'C'), ('C', 'A'), ('B', 'D'), ('D', 'E'); WITH RECURSIVE walk(node, depth, visited_path, display_path) AS (VALUES ('A', 0, '|A|', 'A') UNION ALL SELECT e.to_node, w.depth + 1, w.visited_path || e.to_node || '|', w.display_path || ' > ' || e.to_node FROM walk w JOIN graph_edges e ON e.from_node = w.node WHERE instr(w.visited_path, '|' || e.to_node || '|') = 0) SELECT node, depth, display_path FROM walk ORDER BY depth, node;`,
    hints: [
      'visited_path хранит разделённые маркеры вроде |A|B|.',
      'instr проверяет точный маркер следующего узла, а не подстроку имени.',
      'Переход C → A блокируется, потому что |A| уже присутствует в пути.'
    ]
  },
  'task-175': {
    title: 'Посчитай minimum hops и число путей',
    description: 'Из A найди все достижимые узлы DAG. Рекурсивно перечисли пути, затем для каждого узла верни минимальное число переходов и количество разных путей. MIN(depth) и COUNT(*) отвечают на разные вопросы и не должны смешиваться.',
    starter: `-- Напиши решение с нуля:
-- создай DAG с несколькими путями к D и F,
-- перечисли рекурсивные пути от A,
-- агрегируй minimum_hops и path_count на node.`,
    solution: `CREATE TEMP TABLE reach_edges(from_node TEXT NOT NULL, to_node TEXT NOT NULL); INSERT INTO reach_edges VALUES ('A', 'B'), ('A', 'C'), ('B', 'D'), ('C', 'D'), ('B', 'E'), ('E', 'D'), ('D', 'F'), ('C', 'F'); WITH RECURSIVE paths(node, depth, visited_path) AS (VALUES ('A', 0, '|A|') UNION ALL SELECT e.to_node, p.depth + 1, p.visited_path || e.to_node || '|' FROM paths p JOIN reach_edges e ON e.from_node = p.node WHERE instr(p.visited_path, '|' || e.to_node || '|') = 0 AND p.depth < 6) SELECT node, MIN(depth) AS minimum_hops, COUNT(*) AS path_count FROM paths GROUP BY node ORDER BY node;`,
    hints: [
      'UNION ALL сохраняет разные пути к одному узлу.',
      'MIN(depth) выбирает shortest reachability, COUNT(*) считает все пути.',
      'Visited path и depth cap делают контракт безопасным даже после изменения fixture.'
    ]
  },
  'task-176': {
    title: 'Построй transitive closure для каждого subtree',
    description: 'Создай closure `(ancestor, descendant, depth)` сразу для всех узлов дерева. Anchor включает self-row каждого узла, recursive member добавляет детей. Затем верни число настоящих потомков и максимальную глубину subtree для каждого узла, включая листья.',
    starter: `CREATE TEMP TABLE closure_nodes(
  node_id INTEGER PRIMARY KEY,
  parent_id INTEGER,
  name TEXT NOT NULL
);
INSERT INTO closure_nodes VALUES
  (1, NULL, 'Root'), (2, 1, 'Support'), (3, 1, 'Data'),
  (4, 2, 'L1'), (5, 2, 'L2'),
  (6, 3, 'Analytics'), (7, 6, 'BI');

WITH RECURSIVE closure(ancestor_id, descendant_id, depth) AS (
  SELECT node_id, node_id, 0 FROM closure_nodes
  UNION ALL
  SELECT c.ancestor_id, n.node_id, c.depth + 1
  FROM closure c
  JOIN closure_nodes n ON
)
SELECT n.node_id, n.name,
       SUM(CASE WHEN c.depth > 0 THEN 1 ELSE 0 END) AS descendant_count,
       MAX(c.depth) AS max_depth
FROM closure_nodes n
JOIN closure c ON
GROUP BY n.node_id, n.name
ORDER BY n.node_id;`,
    solution: `CREATE TEMP TABLE closure_nodes(node_id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT NOT NULL); INSERT INTO closure_nodes VALUES (1, NULL, 'Root'), (2, 1, 'Support'), (3, 1, 'Data'), (4, 2, 'L1'), (5, 2, 'L2'), (6, 3, 'Analytics'), (7, 6, 'BI'); WITH RECURSIVE closure(ancestor_id, descendant_id, depth) AS (SELECT node_id, node_id, 0 FROM closure_nodes UNION ALL SELECT c.ancestor_id, n.node_id, c.depth + 1 FROM closure c JOIN closure_nodes n ON n.parent_id = c.descendant_id) SELECT n.node_id, n.name, SUM(CASE WHEN c.depth > 0 THEN 1 ELSE 0 END) AS descendant_count, MAX(c.depth) AS max_depth FROM closure_nodes n JOIN closure c ON c.ancestor_id = n.node_id GROUP BY n.node_id, n.name ORDER BY n.node_id;`,
    hints: [
      'Self-row depth 0 гарантирует присутствие листьев в итоговой агрегации.',
      'Новый descendant присоединяется по parent_id текущего descendant.',
      'descendant_count исключает depth = 0, max_depth оставляет высоту subtree.'
    ]
  },
  'task-177': {
    title: 'Распространи количества по bill of materials',
    description: 'Для одного Bike рассчитай итоговое количество каждого компонента. На каждом уровне cumulative_quantity умножается на edge quantity; один компонент Bolt встречается по двум путям и должен суммироваться после рекурсивного разворачивания.',
    starter: `CREATE TEMP TABLE bom_edges(
  parent_part TEXT NOT NULL,
  child_part TEXT NOT NULL,
  quantity INTEGER NOT NULL
);
INSERT INTO bom_edges VALUES
  ('Bike', 'Wheel', 2), ('Bike', 'Frame', 1),
  ('Wheel', 'Spoke', 20), ('Wheel', 'Tire', 1), ('Wheel', 'Bolt', 5),
  ('Frame', 'Tube', 3), ('Frame', 'Bolt', 2);

WITH RECURSIVE exploded(component, cumulative_quantity, depth, path) AS (
  SELECT child_part, quantity, 1, 'Bike > ' || child_part
  FROM bom_edges
  WHERE
  UNION ALL
  SELECT e.child_part,
         x.cumulative_quantity * e.quantity,
         x.depth + 1,
         x.path || ' > ' || e.child_part
  FROM exploded x
  JOIN bom_edges e ON
)
SELECT component,
       SUM(cumulative_quantity) AS total_quantity,
       MIN(depth) AS first_depth
FROM exploded
GROUP BY component
ORDER BY component;`,
    solution: `CREATE TEMP TABLE bom_edges(parent_part TEXT NOT NULL, child_part TEXT NOT NULL, quantity INTEGER NOT NULL); INSERT INTO bom_edges VALUES ('Bike', 'Wheel', 2), ('Bike', 'Frame', 1), ('Wheel', 'Spoke', 20), ('Wheel', 'Tire', 1), ('Wheel', 'Bolt', 5), ('Frame', 'Tube', 3), ('Frame', 'Bolt', 2); WITH RECURSIVE exploded(component, cumulative_quantity, depth, path) AS (SELECT child_part, quantity, 1, 'Bike > ' || child_part FROM bom_edges WHERE parent_part = 'Bike' UNION ALL SELECT e.child_part, x.cumulative_quantity * e.quantity, x.depth + 1, x.path || ' > ' || e.child_part FROM exploded x JOIN bom_edges e ON e.parent_part = x.component) SELECT component, SUM(cumulative_quantity) AS total_quantity, MIN(depth) AS first_depth FROM exploded GROUP BY component ORDER BY component;`,
    hints: [
      'Anchor берёт прямые компоненты Bike.',
      'Количество ребёнка равно cumulative parent quantity × edge quantity.',
      'GROUP BY после рекурсии объединяет Bolt из Wheel и Frame в total 12.'
    ]
  },
  'task-178': {
    title: 'Перечисли все безопасные пути между двумя узлами',
    description: 'Найди все пути из A в E в ориентированном графе. Храни display path и visited markers, продолжай рекурсию только пока E не достигнут и следующий узел ещё не посещён. Верни каждый путь и число hops.',
    starter: `CREATE TEMP TABLE path_edges(from_node TEXT NOT NULL, to_node TEXT NOT NULL);
INSERT INTO path_edges VALUES
  ('A', 'B'), ('A', 'C'),
  ('B', 'D'), ('C', 'D'),
  ('D', 'E'), ('B', 'E');

WITH RECURSIVE paths(node, hops, visited_path, display_path) AS (
  VALUES ('A', 0, '|A|', 'A')
  UNION ALL
  SELECT e.to_node, p.hops + 1,
         p.visited_path || e.to_node || '|',
         p.display_path || ' > ' || e.to_node
  FROM paths p
  JOIN path_edges e ON
  WHERE p.node <> 'E'
    AND
)
SELECT display_path, hops
FROM paths
WHERE node = 'E'
ORDER BY hops, display_path;`,
    solution: `CREATE TEMP TABLE path_edges(from_node TEXT NOT NULL, to_node TEXT NOT NULL); INSERT INTO path_edges VALUES ('A', 'B'), ('A', 'C'), ('B', 'D'), ('C', 'D'), ('D', 'E'), ('B', 'E'); WITH RECURSIVE paths(node, hops, visited_path, display_path) AS (VALUES ('A', 0, '|A|', 'A') UNION ALL SELECT e.to_node, p.hops + 1, p.visited_path || e.to_node || '|', p.display_path || ' > ' || e.to_node FROM paths p JOIN path_edges e ON e.from_node = p.node WHERE p.node <> 'E' AND instr(p.visited_path, '|' || e.to_node || '|') = 0) SELECT display_path, hops FROM paths WHERE node = 'E' ORDER BY hops, display_path;`,
    hints: [
      'Не расширяй путь после достижения E.',
      'Visited markers защищают от цикла при будущих изменениях edges.',
      'UNION ALL сохраняет три разных пути, включая два пути длины 3.'
    ]
  },
  'task-179': {
    title: 'Оцени blast radius зависимости с multiple paths',
    description: 'От компонента auth найди все downstream-компоненты, минимальную глубину воздействия и число разных dependency paths. Один admin достигается коротким путём через notifications и двумя более длинными путями через reports.',
    starter: `-- Напиши решение с нуля:
-- создай dependency edges от dependency к dependent,
-- перечисли cycle-safe paths от auth,
-- агрегируй min_depth и path_count по component.`,
    solution: `CREATE TEMP TABLE dependency_edges(dependency TEXT NOT NULL, dependent TEXT NOT NULL); INSERT INTO dependency_edges VALUES ('auth', 'profile'), ('auth', 'payments'), ('auth', 'notifications'), ('profile', 'reports'), ('payments', 'reports'), ('reports', 'admin'), ('notifications', 'admin'); WITH RECURSIVE impact(component, depth, visited_path) AS (VALUES ('auth', 0, '|auth|') UNION ALL SELECT e.dependent, i.depth + 1, i.visited_path || e.dependent || '|' FROM impact i JOIN dependency_edges e ON e.dependency = i.component WHERE instr(i.visited_path, '|' || e.dependent || '|') = 0 AND i.depth < 8) SELECT component, MIN(depth) AS min_depth, COUNT(*) AS path_count FROM impact GROUP BY component ORDER BY min_depth, component;`,
    hints: [
      'Каждый recursive row представляет один dependency path.',
      'MIN(depth) показывает ближайшее воздействие, COUNT(*) — число маршрутов риска.',
      'Cycle guard и depth cap защищают production-граф от ошибочных циклов.'
    ]
  },
  'task-180': {
    title: 'Останови untrusted graph depth cap и покажи truncation',
    description: 'Обойди длинную цепочку с обратным циклом, но разреши глубину не больше 4. Для достигнутой frontier-строки верни truncated_frontier = 1, если существует ещё непосещённый исходящий узел. Cap должен не просто обрезать данные, а сделать неполноту наблюдаемой.',
    starter: `-- Напиши решение с нуля:
-- создай цепочку 1→2→…→8 и цикл 8→3,
-- ограничь recursive member depth < 4,
-- отметь frontier, у которой остался непосещённый child.`,
    solution: `CREATE TEMP TABLE bounded_edges(from_node INTEGER NOT NULL, to_node INTEGER NOT NULL); INSERT INTO bounded_edges VALUES (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8), (8, 3); WITH RECURSIVE walk(node, depth, visited_path) AS (VALUES (1, 0, '|1|') UNION ALL SELECT e.to_node, w.depth + 1, w.visited_path || e.to_node || '|' FROM walk w JOIN bounded_edges e ON e.from_node = w.node WHERE w.depth < 4 AND instr(w.visited_path, '|' || e.to_node || '|') = 0) SELECT w.node, w.depth, CASE WHEN w.depth = 4 AND EXISTS (SELECT 1 FROM bounded_edges e WHERE e.from_node = w.node AND instr(w.visited_path, '|' || e.to_node || '|') = 0) THEN 1 ELSE 0 END AS truncated_frontier FROM walk w ORDER BY w.depth, w.node;`,
    hints: [
      'Recursive member разрешён только при current depth < 4.',
      'Visited path остаётся обязательным даже вместе с cap.',
      'Node 5 достигнут на depth 4 и имеет непосещённый child 6, поэтому flag = 1.'
    ]
  }
};

export const recursiveCteAuthoredTaskEvidence: Readonly<Record<string, readonly RecursiveCteEvidenceTag[]>> = {
  'task-171': ['anchor-member', 'termination-predicate', 'bounded-sequence'],
  'task-172': ['downward-hierarchy', 'depth', 'path'],
  'task-173': ['ancestor-chain', 'upward-traversal', 'path'],
  'task-174': ['cycle-guard', 'visited-path', 'reachability'],
  'task-175': ['reachability', 'minimum-hops', 'path-count', 'cycle-guard'],
  'task-176': ['transitive-closure', 'subtree-aggregation', 'depth'],
  'task-177': ['bill-of-materials', 'quantity-propagation', 'path'],
  'task-178': ['path-enumeration', 'multiple-paths', 'cycle-guard'],
  'task-179': ['blast-radius', 'dependency-closure', 'minimum-hops', 'path-count'],
  'task-180': ['depth-cap', 'truncation-evidence', 'cycle-guard']
};

export function advancedRecursiveCteTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedRecursiveCteTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedRecursiveCteTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const recursiveCteAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
