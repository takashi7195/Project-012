-- Indexes for the bounded administrative search filters.
create index if not exists race_entries_projection_rank_age_idx
  on race_data.race_entries (projection_id, rank_code, age_at_race);
create index if not exists race_entries_projection_name_search_idx
  on race_data.race_entries (projection_id, name_search);
create index if not exists payouts_projection_type_amount_idx
  on race_data.payouts (projection_id, bet_type, amount_yen);
