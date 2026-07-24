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
  email TEXT
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
  subject TEXT NOT NULL
);
INSERT INTO engineers VALUES
  (1,'Артём','L2','Core'),
  (2,'Марина','L2','Learning'),
  (3,'Илья','L1','Workplace'),
  (4,'София','L3','Core'),
  (5,'Олег','L2','Learning');
INSERT INTO customers VALUES
  (1,'Москва','Business','ops@north.example'),
  (2,'Казань','Education','admin@campus.example'),
  (3,'Екатеринбург','Business',NULL),
  (4,'Новосибирск','Retail','help@retail.example'),
  (5,'Москва','Education','admin@campus.example'),
  (6,'Пермь','Retail','support@west.example');
INSERT INTO tickets VALUES
  (1001,'VPN','Closed','High',1,1,85,120,'2026-07-01 08:20:00','VPN disconnects'),
  (1002,'LMS','Open','Medium',2,2,NULL,240,'2026-07-01 10:15:00','Course access'),
  (1003,'VPN','Closed','Low',1,3,40,240,'2026-07-02 09:00:00','Client update'),
  (1004,'VDI','Closed','Critical',4,4,510,60,'2026-07-02 11:35:00','VDI unavailable'),
  (1005,'Email','Closed','High',3,5,190,120,'2026-07-03 07:50:00','Mailbox quota'),
  (1006,'VPN','Closed','Critical',2,2,330,60,'2026-07-03 14:10:00','Gateway failure'),
  (1007,'LMS','Open','High',3,1,NULL,120,'2026-07-04 12:30:00','Assignment upload'),
  (1008,'Access','Closed','Low',4,6,25,240,'2026-07-04 16:45:00','Role request'),
  (1009,'VPN','Closed','Medium',1,4,120,240,'2026-07-05 08:05:00','MFA loop'),
  (1010,'Email','Open','Critical',2,3,NULL,60,'2026-07-05 13:25:00','Mail flow stopped'),
  (1011,'Access','Closed','High',4,5,95,120,'2026-07-06 09:40:00','Permission denied'),
  (1012,'LMS','Open','Medium',3,6,NULL,240,'2026-07-06 15:00:00','Video playback');
CREATE INDEX idx_tickets_service ON tickets(service);
CREATE INDEX idx_tickets_engineer ON tickets(engineer_id);
CREATE INDEX idx_tickets_priority_status ON tickets(priority, status);
`;
