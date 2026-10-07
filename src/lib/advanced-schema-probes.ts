import type { TaskSqlEngine } from './task-evaluation-types';

type Database = InstanceType<TaskSqlEngine['Database']>;

/** Behavioral schema checks: SQL spelling and generated index names are irrelevant. */
const schemaProbes: Readonly<Record<string, readonly string[]>> = {
  'task-131': [
    "INSERT INTO service_contracts(service,timeout_minutes) VALUES ('probe-default',30);",
    "INSERT INTO service_contracts VALUES ('probe-email',30,'email');",
    "INSERT INTO service_contracts VALUES ('probe-phone',30,'phone');",
    "INSERT INTO service_contracts VALUES ('probe-bad',30,'fax');",
    "INSERT INTO service_contracts VALUES ('probe-null',30,NULL);"
  ],
  'task-133': [
    "INSERT INTO service_levels_new VALUES ('probe-min',1);",
    "INSERT INTO service_levels_new VALUES ('probe-max',1440);",
    "INSERT INTO service_levels_new VALUES ('probe-low',0);",
    "INSERT INTO service_levels_new VALUES ('probe-high',1441);",
    "INSERT INTO service_levels_new VALUES ('probe-null',NULL);"
  ],
  'task-136': [
    "INSERT INTO legacy_users VALUES (900001,'probe@example.com','probe@example.com');",
    "INSERT INTO legacy_users VALUES (900002,'probe@example.com',NULL);",
    "INSERT INTO legacy_users VALUES (900003,'probe@example.com',(SELECT MIN(email_normalized) FROM legacy_users));"
  ],
  'task-140': [
    "INSERT INTO contact_points VALUES (900001,'email','probe-digest','active');",
    "INSERT INTO contact_points VALUES (900001,'sms','probe-digest','revoked');",
    "INSERT INTO contact_points VALUES (900001,'fax','probe-digest','active');",
    "INSERT INTO contact_points VALUES (900001,'email','probe-digest','pending');",
    "INSERT INTO contact_points VALUES (900001,'email',NULL,'active');",
    "INSERT INTO contact_points VALUES (900001,NULL,'probe-digest','active');",
    "INSERT INTO contact_points VALUES (900001,'email','probe-digest',NULL);",
    "INSERT INTO contact_points VALUES (900001,'email','probe-digest','active'),(900002,'sms','probe-digest','revoked');",
    "INSERT INTO contact_points VALUES (900001,'email','probe-digest','active'),(900001,'sms','probe-other','revoked');"
  ]
};

export function advancedSchemaBehavior(database: Database, taskId: string) {
  return (schemaProbes[taskId] || []).map(sql => {
    database.run('SAVEPOINT academy_schema_probe;');
    let accepted = false;
    try {
      database.run(sql);
      accepted = true;
    } catch {
      // Rejection is an observed contract outcome, not a learner/runtime failure.
    } finally {
      database.run('ROLLBACK TO academy_schema_probe; RELEASE academy_schema_probe;');
    }
    return accepted;
  });
}
