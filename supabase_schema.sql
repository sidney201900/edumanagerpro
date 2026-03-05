-- Create the table for storing the entire application state as a JSON blob
create table if not exists school_data (
  id bigint primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Insert the initial row (id=1) if it doesn't exist so the app has something to fetch/update
insert into school_data (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- Enable Row Level Security (RLS)
alter table school_data enable row level security;

-- Create a policy that allows anyone to read/write (for development/demo purposes)
-- In a real production app, you would restrict this to authenticated users
create policy "Enable read access for all users"
on school_data for select
using (true);

create policy "Enable insert access for all users"
on school_data for insert
with check (true);

create policy "Enable update access for all users"
on school_data for update
using (true);
