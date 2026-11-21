-- "Fixed deal": the sanstha paid a one-time fixed amount.
-- Features are chosen by the owner and stay fixed; the sanstha sees no plan / billing / renewal.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing text NOT NULL DEFAULT 'subscription'; -- subscription | fixed
