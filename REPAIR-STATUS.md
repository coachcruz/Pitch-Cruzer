# Pitch Cruzer repair checkpoint

Updated 2026-10-25. Branch: `fix/shipping-reliability`. Base: `33e9cf1407d675b6a22b55afba85ad7a1061fe11`.

## Release status

User authorized publishing the tested fixes on 2026-10-25 with the remaining issues below disclosed. This is an incremental reliability release, not a claim of full release readiness. Deployment confirmation is tracked separately from this pre-deployment checkpoint.
Passing automated tests do not establish accurate timing on real songs or reliable microphone behavior on phones.

## Verified progress

- Live octave changes no longer feed octave-corrected values back into pitch history.
- Karaoke waits for the word's end and excludes partner/paused intervals.
- Note rebinding preserves saved lyric boundaries; inserted words no longer default to zero.
- Keep-timing redo makes no service calls and preserves boundaries, line IDs and evidence. New lyric requests supersede older jobs.
- Takes retain repetition counts; backups include kept Build recordings; import validates records before an atomic write.
- Storage writes wait for transaction completion; song deletion removes current related records atomically.
- Main recording flow saves raw audio before scoring, guards repeated clicks, and captures selection/repeats at recording start.
- Quota reservations use compare-and-set with global limits and fail closed. Identify inference attempts are individually counted; availability probes are not charged.
- Separation uses deterministic source-based keys and persistent checkpoints. Completed checkpoints reuse saved stems without retaining duplicate audio.
- Cancellation propagates through uploads, link import and downloads; a cancelled direct download does not start a proxy download.
- Conservative onset refinement labels estimated timing; it is not phoneme forced alignment. A regression test covers attacks that could invert short syllable windows.

## Review blockers still open

1. Build mode needs raw-audio recovery before scoring and a pre-await recording guard. Recording ownership also needs enforcement inside LiveMic, not just UI callers.
2. Background lyric completion can change duet parts/analysis during recording. Capture immutable scoring inputs or defer commits until the take completes.
3. Two tabs can claim the same preparation fingerprint, upload separately, and generate different source IDs. Add an atomic recoverable claim before upload/paid work.
4. Review opens/scoring need generation and disposal guards; a slow older open can replace the latest selection.
5. Recording writes need parent/child consistency across concurrent song deletion. Separate saveSong/saveTake calls can recreate a song or orphan a take.
6. Estimated timing needs visible UI treatment and validation against real vocals; amplitude attacks alone do not establish syllable identity.
7. Finish security/import/download-limit review and dependency triage; run browser and real microphone end-to-end checks before release.

## Verification

The final full run passed 190 tests across 24 files, both app/functions type checks, production build, and `git diff --check`.
The onset regression was first run failing, then fixed and verified in that full run.

Two independent read-only reviews (functional specification and architecture/lifecycle) found the blockers above. No clean-review approval or release claim has been issued.
