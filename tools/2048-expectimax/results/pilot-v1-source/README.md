# Archived exploratory version

This source exists only to reproduce the initial exploratory pilot records. Its SHA-256 is `2a6b2c3a591e3cc210b376541ef65b9313968bb0e53394496467221944e6af6a`.

Known validation issue in this exploratory snapshot: some non-power-of-two values can pass input validation. Pilot games only generate exact powers of two, so this issue does not affect their recorded trajectories. The main solver fixes validation and improves exact depth-one cache reuse; use the main solver for all normal tasks.
