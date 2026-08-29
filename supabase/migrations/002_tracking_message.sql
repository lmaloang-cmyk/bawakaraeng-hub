-- Status/pesan singkat yang tampil mengikuti marker Live Tracking.
alter table tracking_sessions add column if not exists tracking_message text;
alter table tracking_sessions add column if not exists tracking_status text;
alter table tracking_sessions add column if not exists tracking_message_updated_at timestamptz;

alter table tracking_sessions drop constraint if exists tracking_message_length;
alter table tracking_sessions add constraint tracking_message_length
  check (tracking_message is null or char_length(tracking_message) <= 120);
