export const trainingSeedSql = `
PRAGMA foreign_keys = ON;
CREATE TABLE engineers(
  engineer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  team TEXT NOT NULL
);
CREATE TABLE customers(
  customer_id INTEGER PRIMARY KEY,
  region TEXT NOT NULL,
  segment TEXT NOT NULL,
  email TEXT,
  phone TEXT
);
CREATE TABLE tickets(
  ticket_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  engineer_id INTEGER NOT NULL REFERENCES engineers(engineer_id),
  customer_id INTEGER REFERENCES customers(customer_id),
  resolution_minutes INTEGER,
  sla_minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  subject TEXT NOT NULL
);
CREATE TABLE service_tree(
  service_id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES service_tree(service_id),
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE ticket_events(
  event_id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(ticket_id),
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE request_samples(
  sample_id INTEGER PRIMARY KEY,
  input_text TEXT NOT NULL,
  risk_level INTEGER NOT NULL CHECK(risk_level IN (0, 1))
);
INSERT INTO engineers VALUES
  (1,'Артём','L2','Core'),
  (2,'Марина','L2','Learning'),
  (3,'Илья','L1','Workplace'),
  (4,'София','L3','Core'),
  (5,'Олег','L2','Learning');
INSERT INTO customers VALUES
  (1,'Москва','Business','ops@north.example','+7-900-100-10-01'),
  (2,'Казань','Education','admin@campus.example','+7-900-100-10-02'),
  (3,'Екатеринбург','Business',NULL,'+7-900-100-10-03'),
  (4,'Новосибирск','Retail','help@retail.example',NULL),
  (5,'Москва','Education','admin@campus.example','+7-900-100-10-05'),
  (6,'Пермь','Retail','support@west.example',NULL),
  (7,'Самара','Business','ops@volga.example','+7-900-100-10-07'),
  (8,'Тула','Education','admin@lab.example',NULL),
  (9,'Омск','Retail',NULL,NULL),
  (10,'Уфа','Business','service@ural.example','+7-900-100-10-10');
INSERT INTO tickets VALUES
  (1001,'VPN','Closed','High',1,1,85,120,'2026-07-01 08:20:00','2026-07-01 09:45:00','VPN disconnects'),
  (1002,'LMS','Open','Medium',2,2,NULL,240,'2026-07-01 10:15:00',NULL,'Course access'),
  (1003,'VPN','Closed','Low',1,3,40,240,'2026-07-02 09:00:00','2026-07-02 09:40:00','Client update'),
  (1004,'VDI','Closed','Critical',4,4,510,60,'2026-07-02 11:35:00','2026-07-02 20:05:00','VDI unavailable'),
  (1005,'Email','Closed','High',3,5,190,120,'2026-07-03 07:50:00','2026-07-03 11:00:00','Mailbox quota'),
  (1006,'VPN','Closed','Critical',2,2,330,60,'2026-07-03 14:10:00','2026-07-03 19:40:00','Gateway failure'),
  (1007,'LMS','Open','High',3,1,NULL,120,'2026-07-04 12:30:00',NULL,'Assignment upload'),
  (1008,'Access','Closed','Low',4,6,25,240,'2026-07-04 16:45:00','2026-07-04 17:10:00','Role request'),
  (1009,'VPN','Closed','Medium',1,4,120,240,'2026-07-05 08:05:00','2026-07-05 10:05:00','MFA loop'),
  (1010,'Email','Open','Critical',2,3,NULL,60,'2026-07-05 13:25:00',NULL,'Mail flow stopped'),
  (1011,'Access','Closed','High',4,5,95,120,'2026-07-06 09:40:00','2026-07-06 11:15:00','Permission denied'),
  (1012,'LMS','Open','Medium',3,6,NULL,240,'2026-07-06 15:00:00',NULL,'Video playback'),
  (1013,'Access','Closed','Medium',5,7,300,180,'2026-07-07 08:30:00','2026-07-07 13:30:00','Delayed role approval'),
  (1014,'Email','Closed','Low',5,8,40,120,'2026-07-07 10:10:00','2026-07-07 10:50:00','Alias configuration');
INSERT INTO service_tree VALUES
  (1,NULL,'Digital Workplace'),
  (2,1,'Remote Access'),
  (3,1,'Collaboration'),
  (4,2,'VPN'),
  (5,2,'VDI'),
  (6,3,'Email'),
  (7,3,'LMS'),
  (8,1,'Identity'),
  (9,8,'Access');
INSERT INTO ticket_events VALUES
  (1,1001,'created','2026-07-01 08:20:00','{"channel":"web","actor":"user","latency_ms":40}'),
  (2,1001,'assigned','2026-07-01 08:25:00','{"channel":"chat","actor":"dispatcher","latency_ms":15}'),
  (3,1001,'closed','2026-07-01 09:45:00','{"channel":"chat","actor":"engineer","latency_ms":55}'),
  (4,1002,'created','2026-07-01 10:15:00','{"channel":"email","actor":"user","latency_ms":120}'),
  (5,1002,'commented','2026-07-01 10:40:00','{"channel":"email","actor":"engineer","latency_ms":80}'),
  (6,1004,'created','2026-07-02 11:35:00','{"channel":"web","actor":"monitoring","latency_ms":25}'),
  (7,1004,'escalated','2026-07-02 11:40:00','{"channel":"chat","actor":"dispatcher","latency_ms":10}'),
  (8,1004,'assigned','2026-07-02 11:45:00','{"channel":"chat","actor":"engineer","latency_ms":18}'),
  (9,1004,'closed','2026-07-02 20:05:00','{"channel":"web","actor":"engineer","latency_ms":65}'),
  (10,1005,'created','2026-07-03 07:50:00','{"channel":"email","actor":"user","latency_ms":95}'),
  (11,1005,'closed','2026-07-03 11:00:00','{"channel":"email","actor":"engineer","latency_ms":70}'),
  (12,1006,'created','2026-07-03 14:10:00','{"channel":"web","actor":"monitoring","latency_ms":20}'),
  (13,1006,'escalated','2026-07-03 14:20:00','{"channel":"chat","actor":"dispatcher","latency_ms":12}'),
  (14,1006,'closed','2026-07-03 19:40:00','{"channel":"chat","actor":"engineer","latency_ms":60}');
INSERT INTO request_samples VALUES
  (1,'1001',0),
  (2,'VPN',0),
  (3,'2026-07-01',0),
  (4,'1 OR 1=1',1),
  (5,'x''; DROP TABLE tickets; --',1),
  (6,'admin@example.test',0),
  (7,'UNION SELECT password FROM users',1),
  (8,'normal search phrase',0),
  (9,'admin'' OR ''1''=''1',1),
  (10,'ticket status report',0),
  (11,'0); DELETE FROM tickets; --',1);
CREATE INDEX idx_tickets_service ON tickets(service);
CREATE INDEX idx_tickets_engineer ON tickets(engineer_id);
CREATE INDEX idx_tickets_priority_status ON tickets(priority, status);
CREATE INDEX idx_ticket_events_ticket_time ON ticket_events(ticket_id, event_at, event_id);
CREATE INDEX idx_service_tree_parent ON service_tree(parent_id);
`;
