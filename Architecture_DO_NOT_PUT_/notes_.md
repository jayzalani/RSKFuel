Adding a coin is a registry entry, not a redeploy: its decimals, its rate source, fee, per-swap and daily caps, and an enabled flag. New tokens start with tiny caps and get raised in steps. The change goes through the timelock, so users can see it coming.

Adding a chain is a new deployment of the same audited contract, with its own reserve in that chain's gas coin, plus a rate adapter for that chain's oracle. I'd keep the core swap path free of bridges and cross-chain messaging. Each chain is self-contained, so a problem on one can't drain another.

Where scale really comes from. Throughput isn't your bottleneck at $10 swaps. Risk limits are. What scales is:

the config-driven code, so a new coin or chain is a config change
stateless services (rate monitor, indexer, frontend) that can run several copies, plus RPC fallbacks
caps that rise only as the audit, monitoring and track record justify it

What makes users trust it:

one quote function shared by the UI and the swap
live, public numbers: reserve, rate age, drift, limits
a verified contract, a multisig and timelock owner, and every parameter change emitted as an event
an audit report and a bug bounty, shown only once they exist
a capped launch that grows in steps

Everything here follows the build phases in the grant doc, so the diagrams and the doc tell one story. The unverified items are the same as before: the RSK oracle for RIF, whether the tokens support permit, and the real gas cost.




What the code shows

The contract and docs have six problems beyond the ones I flagged earlier:

The RIF oracle would misprice swaps. _resolveRate uses the oracle's raw number as "tokens per RBTC". A BTC/USD feed happens to work for USDRIF if you assume it's $1. A RIF/USD feed returns USD per RIF, so enabling it would be badly wrong. RIF needs BTC/USD ÷ RIF/USD. I haven't confirmed the feeds' exact output format.
The preview can disagree with the swap. quoteRBTCOut ignores the min/max output, pause, reserve and deviation checks, so the UI can show a quote that then reverts. _rateFor and _resolveRate are two separate code paths.
The limits are in RBTC, not dollars. They drift as BTC moves. There are no per-address, daily or reserve-floor limits, and no swap deadline.
The contract hardcodes two tokens with duplicated swap functions, so a token registry would need a restructure. It also uses raw transferFrom instead of SafeERC20, and ownership is a single wallet with a one-step transfer.
Docs contradict the code.
The README calls the contract "production-grade", uses three names (RBTCRefuel, RBTCGasStation, RSKFuel), and says rates are manual while this branch adds oracle and keeper.
SECURITY.md is the Rootstock starter kit's, pointing to their contact, not yours.
The deploy defaults are wrong. The USDRIF and RIF defaults are the same address (in deploy.ts and the frontend constants), the placeholder rates are 3000 and 1500, and the seed (0.0001 RBTC) equals one maximum swap.

Already known from earlier: the old tests fail on the constructor, the circuit-breaker event is lost to the revert, the manual rate has no timestamp, and the sponsor route races and has no rollback.

The frontend also doesn't re-quote when the rate changes, since the quote effect only watches amount and token. The market ticker is a separate source.

Where to start

Start with the contract, after three quick decisions. Everything else (ABI, UI, keeper, tests, docs) depends on its interface, so freeze that first.

Confirm the oracle contracts on RSK testnet and mainnet for BTC/USD and RIF/USD: their addresses, decimals, peek output, and update cadence. Also confirm the real USDRIF and RIF addresses and whether they support permit.
Measure the real gas cost of approve plus swap on testnet.
Write the v2 spec: the previewSwap return struct, events, fee model and caps.
Task list

Sizes are my estimates: S under half a day, M 1–2 days, L 3 or more.

#	Task	Size
Decisions		
T1	Verify oracles, token addresses, permit support	S
T2	Measure gas; set gas recovery fee and sponsor amount	S
T3	Freeze v2 interface and fee/cap spec	M
Contract v2		
T4	IRateSource plus adapters (BTC/USD for USDRIF, BTC/USD ÷ RIF/USD for RIF), with timestamps	M
T5	One _computeQuote used by both previewSwap and swap; token registry; deadline	M
T6	Fee model (fixed gas fee + spread), minimum swap, USD-based caps	M
T7	Guardrails: per-address and daily caps, reserve floor, rate age, deviation in setters, guardian role, SafeERC20, two-step ownership	L
T8	Fix breaker event, setter validation	S
Tests and deploy		
T9	Rewrite tests for v2, with fuzz and invariant tests	L
T10	Fix deploy.ts (distinct tokens, config-driven), save address and ABI, verify on explorer	M
Off-chain		
T11	Rate monitor (drift, age alerts); keeper only if a manual path remains	M
T12	Sponsor route: atomic claim, rollback, persistent store, safe errors, daily budget	M
T13	Indexer and stats endpoint	M
Frontend		
T14	Use previewSwap; fee lines, min received, expiry, remaining limits; re-quote on rate change; pre-flight check; revert messages; network guard	L
T15	Trust panel: reserve, status, contract link, owner, recent swaps	M
Proof and docs		
T16	Rewrite README, add your own SECURITY.md, threat model	M
T17	Public testnet beta, demo video, test report	M
T18	Slither, solhint and coverage in CI	S

Order: T1–T3, then T4–T8 and T9 together, then T10, then T11–T15, then T16–T18.

Checklist before you apply

Users can actually use it

 Working swap on testnet with distinct, correct USDRIF and RIF addresses
 UI rate matches the executed rate (preview and swap share one function)
 Fee breakdown and "you receive" shown before confirming
 A new wallet with no RBTC can complete a swap end to end
 Clear messages when a rate changes or a limit is hit

Reviewers can trust it

 Contract verified on the explorer; address in README matches the live one
 Rate source is on-chain and documented, with age and drift visible
 Caps (swap, daily, per-address, reserve floor) live and tested
 Pause and ownership model explained, even if the multisig comes later
 Live public stats: reserve, swaps, volume, success rate
 Tests passing, coverage reported, Slither run with findings addressed

Honest documentation

 One project name; README states real status (testnet, unaudited)
 Your own SECURITY.md and a short threat model
 Unit-economics table and reserve plan

Proposal package

 Demo video and live testnet link
 Milestones with deliverables, KPIs and amounts
 Audit plan, bug bounty plan, mainnet launch plan with caps
 Legal advice for target regions