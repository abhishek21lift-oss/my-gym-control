-- UUID v7 portability shim.
--
-- Postgres 18 ships uuidv7() natively. Postgres 16/17 — including current Supabase
-- instances — do not. Every primary key in this schema defaults to uuidv7(), so the
-- function must exist before any table is created.
--
-- On 18+ this is a no-op: the native implementation is detected and left alone. On
-- older servers it installs a spec-compliant pl/pgsql equivalent (RFC 9562 §5.7:
-- 48-bit big-endian Unix millisecond timestamp, 4-bit version, 2-bit variant, the
-- remaining 74 bits random).

-- gen_random_bytes lives in pgcrypto (unlike gen_random_uuid, which is core since 13).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'uuidv7'
      AND p.pronargs = 0
      AND n.nspname IN ('pg_catalog', current_schema())
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION uuidv7() RETURNS uuid
      LANGUAGE plpgsql
      VOLATILE
      PARALLEL SAFE
      AS $body$
      DECLARE
        unix_ms  bigint;
        bytes    bytea;
      BEGIN
        unix_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

        -- 16 random bytes, then overwrite the first 6 with the timestamp.
        bytes := gen_random_bytes(16);

        bytes := set_byte(bytes, 0, ((unix_ms >> 40) & 255)::int);
        bytes := set_byte(bytes, 1, ((unix_ms >> 32) & 255)::int);
        bytes := set_byte(bytes, 2, ((unix_ms >> 24) & 255)::int);
        bytes := set_byte(bytes, 3, ((unix_ms >> 16) & 255)::int);
        bytes := set_byte(bytes, 4, ((unix_ms >>  8) & 255)::int);
        bytes := set_byte(bytes, 5, ( unix_ms        & 255)::int);

        -- Byte 6: version 7 in the high nibble, random low nibble preserved.
        bytes := set_byte(bytes, 6, ((get_byte(bytes, 6) & 15) | 112));
        -- Byte 8: RFC 9562 variant (10xxxxxx).
        bytes := set_byte(bytes, 8, ((get_byte(bytes, 8) & 63) | 128));

        RETURN encode(bytes, 'hex')::uuid;
      END;
      $body$;
    $fn$;
  END IF;
END;
$$;
