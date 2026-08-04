import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type IncidentInvestigationEvidenceTag =
  | 'incident-window'
  | 'baseline-comparison'
  | 'rate-delta'
  | 'volume-hypothesis'
  | 'latency-hypothesis'
  | 'data-quality-falsification'
  | 'duplicate-audit'
  | 'missingness-audit'
  | 'segment-localization'
  | 'excess-error-estimate'
  | 'competing-hypotheses'
  | 'threshold-evidence'
  | 'temporal-correlation'
  | 'deployment-correlation'
  | 'user-impact'
  | 'cohort-grain'
  | 'evidence-matrix'
  | 'contradiction-weight'
  | 'root-cause-ranking'
  | 'blast-radius'
  | 'affected-population'
  | 'evidence-report'
  | 'recovery-proof'
  | 'investigation-reconciliation';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-231': {
    title: 'Сравни incident window с baseline',
    description: 'Зафиксируй incident window 1–2 августа и сопоставимый baseline 28–30 июля. Для каждого сервиса посчитай breach rate по суммарному знаменателю, затем выведи изменение в процентных пунктах, чтобы расследование начиналось с измеримого отклонения, а не с впечатления.',
    starter: `CREATE TEMP TABLE ticket_metrics(metric_date TEXT NOT NULL, service TEXT NOT NULL, tickets INTEGER NOT NULL, breached INTEGER NOT NULL);
INSERT INTO ticket_metrics VALUES
 ('2026-07-28','VPN',100,5), ('2026-07-29','VPN',110,6), ('2026-07-30','VPN',90,4),
 ('2026-08-01','VPN',120,24), ('2026-08-02','VPN',130,26),
 ('2026-07-28','LMS',80,4), ('2026-07-29','LMS',85,5), ('2026-07-30','LMS',75,3),
 ('2026-08-01','LMS',82,5), ('2026-08-02','LMS',78,4);

WITH classified AS (
  SELECT *,
         CASE WHEN metric_date BETWEEN  THEN 'incident'
              WHEN metric_date BETWEEN  THEN 'baseline' END AS period
  FROM ticket_metrics
)
-- агрегируй rate по service,period и сравни периоды`,
    solution: `CREATE TEMP TABLE ticket_metrics(metric_date TEXT NOT NULL, service TEXT NOT NULL, tickets INTEGER NOT NULL, breached INTEGER NOT NULL);
INSERT INTO ticket_metrics VALUES
 ('2026-07-28','VPN',100,5), ('2026-07-29','VPN',110,6), ('2026-07-30','VPN',90,4),
 ('2026-08-01','VPN',120,24), ('2026-08-02','VPN',130,26),
 ('2026-07-28','LMS',80,4), ('2026-07-29','LMS',85,5), ('2026-07-30','LMS',75,3),
 ('2026-08-01','LMS',82,5), ('2026-08-02','LMS',78,4);
WITH classified AS (
  SELECT *, CASE WHEN metric_date BETWEEN '2026-08-01' AND '2026-08-02' THEN 'incident'
                 WHEN metric_date BETWEEN '2026-07-28' AND '2026-07-30' THEN 'baseline' END AS period
  FROM ticket_metrics
), rates AS (
  SELECT service, period, SUM(tickets) AS tickets, SUM(breached) AS breached,
         ROUND(100.0 * SUM(breached) / SUM(tickets), 2) AS breach_rate
  FROM classified WHERE period IS NOT NULL GROUP BY service, period
), pivoted AS (
  SELECT service,
         MAX(CASE WHEN period='baseline' THEN breach_rate END) AS baseline_rate,
         MAX(CASE WHEN period='incident' THEN breach_rate END) AS incident_rate
  FROM rates GROUP BY service
)
SELECT service, baseline_rate, incident_rate,
       ROUND(incident_rate - baseline_rate, 2) AS rate_delta_pp
FROM pivoted ORDER BY rate_delta_pp DESC, service;`,
    hints: ['Сначала присвой каждой строке baseline или incident.', 'Rate считается как SUM(breached) / SUM(tickets), а не среднее дневных процентов.', 'Pivot через MAX(CASE...) даёт обе ставки в одной строке сервиса.']
  },
  'task-232': {
    title: 'Отдели всплеск latency от всплеска нагрузки',
    description: 'Сравни среднее число запросов и p95 latency в baseline и incident окнах. Классифицируй ситуацию как latency spike без volume spike, только если объём изменился меньше чем на 10%, а p95 вырос минимум вдвое; это проверяет популярную, но часто ложную гипотезу о перегрузке.',
    starter: `CREATE TEMP TABLE hourly_metrics(hour_start TEXT PRIMARY KEY, requests INTEGER NOT NULL, p95_ms INTEGER NOT NULL);
INSERT INTO hourly_metrics VALUES
 ('2026-07-31T09:00:00Z',1000,220), ('2026-07-31T10:00:00Z',1050,230), ('2026-07-31T11:00:00Z',980,210),
 ('2026-08-01T09:00:00Z',1020,650), ('2026-08-01T10:00:00Z',1060,710), ('2026-08-01T11:00:00Z',990,680);

-- собери baseline/incident summary, проценты изменения и finding`,
    solution: `CREATE TEMP TABLE hourly_metrics(hour_start TEXT PRIMARY KEY, requests INTEGER NOT NULL, p95_ms INTEGER NOT NULL);
INSERT INTO hourly_metrics VALUES
 ('2026-07-31T09:00:00Z',1000,220), ('2026-07-31T10:00:00Z',1050,230), ('2026-07-31T11:00:00Z',980,210),
 ('2026-08-01T09:00:00Z',1020,650), ('2026-08-01T10:00:00Z',1060,710), ('2026-08-01T11:00:00Z',990,680);
WITH summary AS (
 SELECT CASE WHEN hour_start < '2026-08-01' THEN 'baseline' ELSE 'incident' END AS period,
        ROUND(AVG(requests),1) AS avg_requests, ROUND(AVG(p95_ms),1) AS avg_p95_ms
 FROM hourly_metrics GROUP BY period
), pivoted AS (
 SELECT MAX(CASE WHEN period='baseline' THEN avg_requests END) baseline_requests,
        MAX(CASE WHEN period='incident' THEN avg_requests END) incident_requests,
        MAX(CASE WHEN period='baseline' THEN avg_p95_ms END) baseline_p95,
        MAX(CASE WHEN period='incident' THEN avg_p95_ms END) incident_p95
 FROM summary
)
SELECT baseline_requests, incident_requests,
       ROUND(100.0*(incident_requests-baseline_requests)/baseline_requests,2) AS request_change_pct,
       baseline_p95, incident_p95,
       ROUND(100.0*(incident_p95-baseline_p95)/baseline_p95,2) AS p95_change_pct,
       CASE WHEN ABS(100.0*(incident_requests-baseline_requests)/baseline_requests) < 10
                 AND incident_p95 >= baseline_p95*2 THEN 'latency-spike-without-volume-spike'
            ELSE 'needs-more-evidence' END AS finding
FROM pivoted;`,
    hints: ['Раздели периоды по дате hour_start.', 'Сравни относительное изменение requests и p95.', 'Небольшое изменение нагрузки не подтверждает traffic-surge hypothesis.']
  },
  'task-233': {
    title: 'Фальсифицируй инцидент через качество данных',
    description: 'До поиска причины проверь, не создан ли симптом самим набором данных. Посчитай duplicate event IDs, NULL service, отрицательные duration и отсутствующее время; итоговая классификация должна явно показать, можно ли доверять метрикам без очистки или отдельной корректировки.',
    starter: `CREATE TEMP TABLE incident_events(event_id INTEGER, ticket_id INTEGER, service TEXT, duration_ms INTEGER, event_at TEXT);
INSERT INTO incident_events VALUES
 (1,101,'VPN',500,'2026-08-01T10:00:00Z'),
 (1,101,'VPN',500,'2026-08-01T10:00:00Z'),
 (2,102,NULL,700,'2026-08-01T10:01:00Z'),
 (3,103,'VPN',-5,'2026-08-01T10:02:00Z'),
 (4,104,'LMS',300,'2026-08-01T10:03:00Z'),
 (5,105,'VPN',900,NULL);

-- верни total, distinct, duplicates и все quality defects`,
    solution: `CREATE TEMP TABLE incident_events(event_id INTEGER, ticket_id INTEGER, service TEXT, duration_ms INTEGER, event_at TEXT);
INSERT INTO incident_events VALUES
 (1,101,'VPN',500,'2026-08-01T10:00:00Z'),
 (1,101,'VPN',500,'2026-08-01T10:00:00Z'),
 (2,102,NULL,700,'2026-08-01T10:01:00Z'),
 (3,103,'VPN',-5,'2026-08-01T10:02:00Z'),
 (4,104,'LMS',300,'2026-08-01T10:03:00Z'),
 (5,105,'VPN',900,NULL);
WITH counts AS (
 SELECT COUNT(*) total_rows, COUNT(DISTINCT event_id) distinct_event_ids,
        SUM(service IS NULL) null_service_rows,
        SUM(duration_ms < 0) impossible_duration_rows,
        SUM(event_at IS NULL) null_time_rows
 FROM incident_events
)
SELECT total_rows, distinct_event_ids,
       total_rows - distinct_event_ids AS duplicate_rows,
       null_service_rows, impossible_duration_rows, null_time_rows,
       CASE WHEN total_rows - distinct_event_ids + null_service_rows + impossible_duration_rows + null_time_rows > 0
            THEN 'quality-risk-present' ELSE 'quality-clean' END AS quality_state
FROM counts;`,
    hints: ['Duplicate rows = COUNT(*) - COUNT(DISTINCT event_id).', 'SUM(condition) удобно считает дефекты в SQLite.', 'Quality risk не доказывает отсутствие инцидента, но ограничивает доверие к выводам.']
  },
  'task-234': {
    title: 'Локализуй сегмент и оцени excess errors',
    description: 'Разрежь baseline и incident по service и region, рассчитай изменение error rate и оцени число лишних ошибок на incident traffic. Ранжирование должно показать не просто максимальный процент, а сегмент с наибольшим абсолютным вкладом в пользовательский ущерб.',
    starter: `-- Напиши расследование с нуля:
-- создай baseline/incident metrics для VPN/LMS и eu/us;
-- посчитай rate по каждой паре service,region;
-- выведи delta_pp, incident_requests и excess_errors_estimate;
-- отсортируй по абсолютному вкладу в инцидент.`,
    solution: `CREATE TEMP TABLE service_region_metrics(period TEXT NOT NULL, service TEXT NOT NULL, region TEXT NOT NULL, requests INTEGER NOT NULL, errors INTEGER NOT NULL);
INSERT INTO service_region_metrics VALUES
 ('baseline','VPN','eu',1000,20), ('incident','VPN','eu',1100,220),
 ('baseline','VPN','us',900,18), ('incident','VPN','us',920,20),
 ('baseline','LMS','eu',800,16), ('incident','LMS','eu',830,18),
 ('baseline','LMS','us',700,14), ('incident','LMS','us',710,15);
WITH rates AS (
 SELECT service, region, period, requests, errors, ROUND(100.0*errors/requests,2) error_rate
 FROM service_region_metrics
), compared AS (
 SELECT service, region,
        MAX(CASE WHEN period='baseline' THEN error_rate END) baseline_rate,
        MAX(CASE WHEN period='incident' THEN error_rate END) incident_rate,
        SUM(CASE WHEN period='incident' THEN requests ELSE 0 END) incident_requests
 FROM rates GROUP BY service, region
)
SELECT service, region, baseline_rate, incident_rate,
       ROUND(incident_rate-baseline_rate,2) AS delta_pp,
       incident_requests,
       ROUND((incident_rate-baseline_rate)*incident_requests/100.0,1) AS excess_errors_estimate
FROM compared ORDER BY excess_errors_estimate DESC, service, region;`,
    hints: ['Сначала сохрани rate каждого периода.', 'Excess errors ≈ delta_pp × incident_requests / 100.', 'Сортируй по excess_errors_estimate, а не только по delta_pp.']
  },
  'task-235': {
    title: 'Сравни конкурирующие гипотезы по порогам',
    description: 'Собери несколько конкурирующих гипотез с ожидаемым сигналом, наблюдаемым значением и порогом. Классифицируй evidence как supported или not-supported и покажи margin; задача не выбирает любимую причину заранее, а делает правила подтверждения явными и воспроизводимыми.',
    starter: `-- Напиши решение с нуля:
-- создай hypothesis_evidence для traffic surge, dependency latency,
-- bad release и database saturation;
-- поддержи направления gte/lte;
-- верни evidence_state и margin, supported hypotheses первыми.`,
    solution: `CREATE TEMP TABLE hypothesis_evidence(hypothesis TEXT PRIMARY KEY, expected_signal TEXT NOT NULL, observed_value REAL NOT NULL, threshold REAL NOT NULL, direction TEXT NOT NULL);
INSERT INTO hypothesis_evidence VALUES
 ('traffic-surge','request_change_pct',3.0,20.0,'gte'),
 ('dependency-latency','dependency_p95_ms',820.0,500.0,'gte'),
 ('bad-release','new_version_error_rate',18.0,10.0,'gte'),
 ('database-saturation','db_cpu_pct',42.0,85.0,'gte');
SELECT hypothesis, expected_signal, observed_value, threshold,
       CASE WHEN direction='gte' AND observed_value >= threshold THEN 'supported'
            WHEN direction='lte' AND observed_value <= threshold THEN 'supported'
            ELSE 'not-supported' END AS evidence_state,
       ROUND(CASE WHEN direction='gte' THEN observed_value-threshold ELSE threshold-observed_value END,1) AS margin
FROM hypothesis_evidence
ORDER BY CASE evidence_state WHEN 'supported' THEN 0 ELSE 1 END, margin DESC, hypothesis;`,
    hints: ['Порог и направление являются частью hypothesis contract.', 'Отрицательный margin показывает, насколько сигнал не достиг порога.', 'Несколько hypotheses могут одновременно оставаться supported.']
  },
  'task-236': {
    title: 'Проверь временную связь релиза и ошибки',
    description: 'Свяжи deployments с получасовыми error windows того же сервиса. Сравни ошибки за час до и первый час после релиза, затем выдели сильную временную корреляцию только при крупном абсолютном уровне и кратном росте; близость по времени считается evidence, но ещё не окончательной причинностью.',
    starter: `CREATE TEMP TABLE deployments(deploy_id INTEGER PRIMARY KEY, service TEXT NOT NULL, version TEXT NOT NULL, deployed_at TEXT NOT NULL);
CREATE TEMP TABLE error_windows(window_start TEXT NOT NULL, service TEXT NOT NULL, errors INTEGER NOT NULL, PRIMARY KEY(window_start, service));

-- заполни VPN/LMS fixtures, вычисли minutes_from_deploy,
-- сравни prior hour и first hour, затем классифицируй correlation_state`,
    solution: `CREATE TEMP TABLE deployments(deploy_id INTEGER PRIMARY KEY, service TEXT NOT NULL, version TEXT NOT NULL, deployed_at TEXT NOT NULL);
CREATE TEMP TABLE error_windows(window_start TEXT NOT NULL, service TEXT NOT NULL, errors INTEGER NOT NULL, PRIMARY KEY(window_start, service));
INSERT INTO deployments VALUES
 (1,'VPN','2.4.0','2026-08-01T09:45:00Z'),
 (2,'LMS','5.1.0','2026-08-01T08:00:00Z');
INSERT INTO error_windows VALUES
 ('2026-08-01T09:30:00Z','VPN',8),
 ('2026-08-01T10:00:00Z','VPN',95),
 ('2026-08-01T10:30:00Z','VPN',110),
 ('2026-08-01T09:30:00Z','LMS',7),
 ('2026-08-01T10:00:00Z','LMS',8);
WITH joined AS (
 SELECT d.deploy_id,d.service,d.version,d.deployed_at,e.window_start,e.errors,
        ROUND((julianday(e.window_start)-julianday(d.deployed_at))*24*60,1) AS minutes_from_deploy
 FROM deployments d JOIN error_windows e ON e.service=d.service
), summary AS (
 SELECT deploy_id,service,version,deployed_at,
        SUM(CASE WHEN minutes_from_deploy BETWEEN 0 AND 60 THEN errors ELSE 0 END) errors_first_hour,
        SUM(CASE WHEN minutes_from_deploy BETWEEN -60 AND -1 THEN errors ELSE 0 END) errors_prior_hour
 FROM joined GROUP BY deploy_id,service,version,deployed_at
)
SELECT deploy_id, service, version, errors_prior_hour, errors_first_hour,
       errors_first_hour-errors_prior_hour AS error_increase,
       CASE WHEN errors_first_hour >= errors_prior_hour*5 AND errors_first_hour >= 50
            THEN 'strong-temporal-correlation' ELSE 'weak-correlation' END AS correlation_state
FROM summary ORDER BY error_increase DESC;`,
    hints: ['Соединяй только окна того же service.', 'julianday позволяет получить минуты относительно deploy.', 'Нужны и кратный рост, и минимальный абсолютный объём ошибок.']
  },
  'task-237': {
    title: 'Измерь blast radius на уровне пользователей',
    description: 'Не ограничивайся долей неуспешных запросов: по plan и region посчитай число пользователей, долю затронутых пользователей и request failure rate. Эти две метрики отвечают на разные вопросы и предотвращают вывод по одному крупному пользователю или неравным объёмам трафика.',
    starter: `CREATE TEMP TABLE user_impact(user_id INTEGER PRIMARY KEY, plan TEXT NOT NULL, region TEXT NOT NULL, failed_requests INTEGER NOT NULL, total_requests INTEGER NOT NULL);
INSERT INTO user_impact VALUES
 (1,'enterprise','eu',8,10), (2,'enterprise','eu',6,10), (3,'enterprise','us',0,20),
 (4,'standard','eu',2,20), (5,'standard','eu',1,20), (6,'standard','us',0,20);

-- посчитай user impact и request impact по plan,region`,
    solution: `CREATE TEMP TABLE user_impact(user_id INTEGER PRIMARY KEY, plan TEXT NOT NULL, region TEXT NOT NULL, failed_requests INTEGER NOT NULL, total_requests INTEGER NOT NULL);
INSERT INTO user_impact VALUES
 (1,'enterprise','eu',8,10), (2,'enterprise','eu',6,10), (3,'enterprise','us',0,20),
 (4,'standard','eu',2,20), (5,'standard','eu',1,20), (6,'standard','us',0,20);
WITH per_user AS (
 SELECT *, ROUND(100.0*failed_requests/total_requests,1) failure_rate,
        CASE WHEN failed_requests>0 THEN 1 ELSE 0 END impacted
 FROM user_impact
)
SELECT plan, region, COUNT(*) users, SUM(impacted) impacted_users,
       ROUND(100.0*SUM(impacted)/COUNT(*),1) impacted_user_pct,
       SUM(failed_requests) failed_requests, SUM(total_requests) total_requests,
       ROUND(100.0*SUM(failed_requests)/SUM(total_requests),1) request_failure_pct
FROM per_user GROUP BY plan,region
ORDER BY request_failure_pct DESC, plan, region;`,
    hints: ['impacted user — пользователь хотя бы с одной ошибкой.', 'Request rate использует SUM(failed)/SUM(total).', 'Сохрани entity grain: сначала per_user, затем cohort.']
  },
  'task-238': {
    title: 'Ранжируй причины через evidence matrix',
    description: 'Для каждой гипотезы агрегируй взвешенные supporting, contradicting и neutral evidence items. Положительный вес поддерживает гипотезу, противоречие вычитается; выведи evidence score и rank, чтобы итоговая причина опиралась на набор независимых наблюдений, а не на одну корреляцию.',
    starter: `CREATE TEMP TABLE evidence_matrix(hypothesis TEXT NOT NULL, evidence_name TEXT NOT NULL, weight INTEGER NOT NULL, result TEXT NOT NULL);

-- добавь evidence для bad release, dependency outage и traffic surge;
-- вычисли score: supports +weight, contradicts -weight, neutral 0;
-- посчитай виды evidence и DENSE_RANK по score.`,
    solution: `CREATE TEMP TABLE evidence_matrix(hypothesis TEXT NOT NULL, evidence_name TEXT NOT NULL, weight INTEGER NOT NULL, result TEXT NOT NULL);
INSERT INTO evidence_matrix VALUES
 ('bad-release','error starts after deploy',3,'supports'),
 ('bad-release','only new version affected',3,'supports'),
 ('bad-release','rollback lowers errors',4,'supports'),
 ('dependency-outage','dependency latency high',3,'supports'),
 ('dependency-outage','other consumers affected',4,'contradicts'),
 ('traffic-surge','request volume increased',2,'contradicts'),
 ('traffic-surge','queue depth increased',2,'neutral');
WITH scored AS (
 SELECT hypothesis,
        SUM(CASE result WHEN 'supports' THEN weight WHEN 'contradicts' THEN -weight ELSE 0 END) evidence_score,
        SUM(result='supports') supporting_items,
        SUM(result='contradicts') contradicting_items,
        SUM(result='neutral') neutral_items
 FROM evidence_matrix GROUP BY hypothesis
)
SELECT hypothesis,evidence_score,supporting_items,contradicting_items,neutral_items,
       DENSE_RANK() OVER (ORDER BY evidence_score DESC) AS hypothesis_rank
FROM scored ORDER BY hypothesis_rank,hypothesis;`,
    hints: ['Отрицательное evidence должно уменьшать score.', 'Сохрани counts supporting/contradicting/neutral.', 'Rank — приоритизация следующей проверки, а не математическая гарантия причины.']
  },
  'task-239': {
    title: 'Собери точный список затронутых пользователей',
    description: 'После подтверждения проблемной версии определи blast radius только по неуспешным VPN-запросам версии 2.4.0. Сначала агрегируй failures на user grain, затем верни по региону число пользователей, число ошибок и детерминированный список user IDs для поддержки и последующей коммуникации.',
    starter: `-- Напиши решение с нуля:
-- создай requests с разными services, versions, regions и outcomes;
-- отфильтруй только failed VPN 2.4.0;
-- агрегируй сначала по user_id,region;
-- затем верни affected_users, failed_requests и ordered user IDs.`,
    solution: `CREATE TEMP TABLE requests(request_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, service TEXT NOT NULL, version TEXT NOT NULL, region TEXT NOT NULL, succeeded INTEGER NOT NULL);
INSERT INTO requests VALUES
 (1,10,'VPN','2.4.0','eu',0),
 (2,10,'VPN','2.4.0','eu',0),
 (3,11,'VPN','2.4.0','eu',0),
 (4,12,'VPN','2.3.9','eu',1),
 (5,13,'VPN','2.4.0','us',1),
 (6,14,'LMS','5.1.0','eu',1);
WITH affected AS (
 SELECT user_id, region, COUNT(*) failed_requests
 FROM requests
 WHERE service='VPN' AND version='2.4.0' AND succeeded=0
 GROUP BY user_id,region
)
SELECT region, COUNT(*) affected_users, SUM(failed_requests) failed_requests,
       GROUP_CONCAT(user_id, ',') AS affected_user_ids
FROM (SELECT * FROM affected ORDER BY region,user_id)
GROUP BY region ORDER BY failed_requests DESC,region;`,
    hints: ['Фильтр фиксирует подтверждённую affected population.', 'Сначала агрегируй на user grain, чтобы не считать пользователя несколько раз.', 'Ordered subquery делает GROUP_CONCAT воспроизводимым.']
  },
  'task-240': {
    title: 'Собери воспроизводимый incident evidence report',
    description: 'Сформируй итоговый набор фактов по scope, timing, quality falsification, основной гипотезе, действию, восстановлению и follow-up. Посчитай статусы, evidence gap и report readiness; расследование считается завершённым только при доказанном восстановлении и явно открытом профилактическом действии.',
    starter: `-- Напиши итоговый evidence report с нуля:
-- создай facts для scope, timing, quality, hypothesis, action, recovery, followup;
-- посчитай confirmed/supported/rejected/open;
-- сравни с ожидаемыми семью фактами;
-- верни evidence_gap и report_state.`,
    solution: `CREATE TEMP TABLE investigation_facts(fact_id INTEGER PRIMARY KEY, category TEXT NOT NULL, statement TEXT NOT NULL, status TEXT NOT NULL);
INSERT INTO investigation_facts VALUES
 (1,'scope','VPN eu error rate increased','confirmed'),
 (2,'timing','spike begins after 2.4.0 deploy','confirmed'),
 (3,'quality','duplicate rows explain spike','rejected'),
 (4,'hypothesis','2.4.0 regression is primary cause','supported'),
 (5,'action','rollback completed','confirmed'),
 (6,'recovery','error rate returned to baseline','confirmed'),
 (7,'followup','add canary guardrail','open');
WITH counts AS (
 SELECT COUNT(*) total_facts,
        SUM(status='confirmed') confirmed_facts,
        SUM(status='supported') supported_hypotheses,
        SUM(status='rejected') rejected_hypotheses,
        SUM(status='open') open_actions
 FROM investigation_facts
), required AS (SELECT 7 expected_facts)
SELECT total_facts,confirmed_facts,supported_hypotheses,rejected_hypotheses,open_actions,
       expected_facts-total_facts AS evidence_gap,
       CASE WHEN confirmed_facts>=4 AND supported_hypotheses>=1 AND open_actions>=1 AND expected_facts=total_facts
            THEN 'report-ready' ELSE 'incomplete-report' END AS report_state
FROM counts CROSS JOIN required;`,
    hints: ['Итоговый отчёт отделяет confirmed facts от supported hypothesis.', 'Recovery proof обязателен, иначе инцидент не закрыт.', 'Open follow-up должен оставаться видимым, а evidence_gap — быть нулевым.']
  }
};

export const incidentInvestigationAuthoredTaskEvidence: Readonly<Record<string, readonly IncidentInvestigationEvidenceTag[]>> = {
  'task-231': ['incident-window', 'baseline-comparison', 'rate-delta'],
  'task-232': ['baseline-comparison', 'volume-hypothesis', 'latency-hypothesis'],
  'task-233': ['data-quality-falsification', 'duplicate-audit', 'missingness-audit'],
  'task-234': ['segment-localization', 'rate-delta', 'excess-error-estimate'],
  'task-235': ['competing-hypotheses', 'threshold-evidence'],
  'task-236': ['temporal-correlation', 'deployment-correlation'],
  'task-237': ['user-impact', 'cohort-grain', 'blast-radius'],
  'task-238': ['evidence-matrix', 'contradiction-weight', 'root-cause-ranking'],
  'task-239': ['blast-radius', 'affected-population', 'cohort-grain'],
  'task-240': ['evidence-report', 'recovery-proof', 'investigation-reconciliation']
};

export function advancedIncidentInvestigationTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedIncidentInvestigationTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedIncidentInvestigationTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}
