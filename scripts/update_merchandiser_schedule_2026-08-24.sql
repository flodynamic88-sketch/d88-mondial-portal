-- One-off data update, NOT a schema migration.
-- Source: user-uploaded "UPDATED MERCHANDISER SCHEDULE 08-24.xlsx" (DC sheet),
-- diffed against the original file that seeded migration 0069_merchandiser_schedules.sql.
-- Diff result: 0 stores added, 1 store removed (TMP MET LIVE PASAY -- left
-- untouched below, see note at bottom), 6 stores changed (this file).
--
-- Targeted UPDATEs only (matched by normalized portal_store_name), never a
-- truncate/reinsert -- route_plan_invoices.merchandiser_schedule_id is a FK
-- into this table, so ids must be preserved.

-- 1. TMP EASTWOOD LIBIS
UPDATE merchandiser_schedules
SET merchandiser_name = 'Hassan,Nadzma',
    merchandiser_status = 'ASSIGNED',
    schedule_raw = 'SUN/WED/FRI',
    schedule_days = ARRAY['SUN','WED','FRI'],
    day_off = 'MONDAY'
WHERE UPPER(TRIM(portal_store_name)) = 'TMP EASTWOOD LIBIS';

-- 2. TMP PARQAL ASEANA CITY
UPDATE merchandiser_schedules
SET merchandiser_name = 'Castañeda,Marthy',
    schedule_raw = 'MON/THUR/SAT',
    schedule_days = ARRAY['MON','THU','SAT'],
    visit_time_window = '7:00AM-4:00PM',
    day_off = 'WEDNESDAY'
WHERE UPPER(TRIM(portal_store_name)) = 'TMP PARQAL ASEANA CITY';

-- 3. SW ANABU IMUS (merchandiser_name / day_off unchanged -- schedule only)
UPDATE merchandiser_schedules
SET schedule_raw = 'MON/THUR/SAT',
    schedule_days = ARRAY['MON','THU','SAT']
WHERE UPPER(TRIM(portal_store_name)) = 'SW ANABU IMUS';

-- 4. RE BABO SACAN PORAC PAMPANGA
UPDATE merchandiser_schedules
SET merchandiser_name = 'Cayetano,Suzette Nazareno',
    merchandiser_status = 'ASSIGNED',
    schedule_raw = 'Wed/Fri/Sun',
    schedule_days = ARRAY['WED','FRI','SUN'],
    visit_time_window = '2:00PM - 6:00pm',
    day_off = 'TUESDAY'
WHERE UPPER(TRIM(portal_store_name)) = 'RE BABO SACAN PORAC PAMPANGA';

-- 5. RS MAIN SQUARE MOLINO
UPDATE merchandiser_schedules
SET schedule_raw = 'TUE',
    schedule_days = ARRAY['TUE']
WHERE UPPER(TRIM(portal_store_name)) = 'RS MAIN SQUARE MOLINO';

-- 6. RE GENERAL AVENUE QC
-- NOTE: source value is "MON/FSAT" -- "FSAT" doesn't match any weekday
-- abbreviation used elsewhere in this table (likely a typo, maybe meant to
-- be split as MON/F/SAT or similar). schedule_raw stores the literal text
-- for fidelity; schedule_days conservatively keeps only the recognized
-- "MON" token. Flagged to the user for confirmation -- do not treat as final
-- until confirmed.
UPDATE merchandiser_schedules
SET schedule_raw = 'MON/FSAT',
    schedule_days = ARRAY['MON'],
    visit_time_window = '9:00am-6:00pm'
WHERE UPPER(TRIM(portal_store_name)) = 'RE GENERAL AVENUE QC';

-- Sanity check: confirm each WHERE matched exactly 1 row before trusting the
-- updates above (run first if you want to verify targets before writing):
-- SELECT portal_store_name, id FROM merchandiser_schedules
-- WHERE UPPER(TRIM(portal_store_name)) IN (
--   'TMP EASTWOOD LIBIS','TMP PARQAL ASEANA CITY','SW ANABU IMUS',
--   'RE BABO SACAN PORAC PAMPANGA','RS MAIN SQUARE MOLINO','RE GENERAL AVENUE QC'
-- );

-- TMP MET LIVE PASAY: no longer in the updated file (removed by JMD).
-- Deliberately NOT deleted here -- see chat message to user.
