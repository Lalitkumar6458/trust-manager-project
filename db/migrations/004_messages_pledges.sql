-- birthday / anniversary greetings look donors up by month-day
CREATE INDEX IF NOT EXISTS donors_dob_md ON donors ((data->'dobMD'));
CREATE INDEX IF NOT EXISTS donors_ann_md ON donors ((data->'anniversaryMD'));
CREATE INDEX IF NOT EXISTS donations_pledge ON donations ((data->'pledgeId'));
