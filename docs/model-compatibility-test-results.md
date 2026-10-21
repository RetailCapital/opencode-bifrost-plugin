# Model Compatibility Test Results

## Scope

This report records the live OpenCode compatibility sweep run against every model that `@retailcapital/bifrost-opencode-plugin` exposed from Bifrost on 2026-10-20.

- Bifrost catalog models: 225
- Models admitted by the plugin: 99
- Models excluded by the plugin: 126
- Exposed models that passed: 75
- Exposed models that failed or were inconclusive: 24
- OpenCode-recorded suite cost: **$6.203206675**
- Suite token totals: 1,859,576 input; 23,220 output; 7,756 reasoning; 995,409 cache read; 0 cache write
- Suite window: 2026-10-20 19:50:54 UTC through 2026-10-20 20:00:25 UTC
- Wall-clock window: approximately 9 minutes 31 seconds with four concurrent probes

The total above is the sum persisted by OpenCode in `opencode.db` for the 99 sessions. It is the complete OpenCode-recorded cost for this sweep, including costs recorded for failed attempts. It may be lower than provider billing when a catalog entry has no usable pricing. In this run, the three Muse Spark models reported `$0` because Bifrost supplied no usable prompt and completion prices for them.

## Probe Method

Each model received the same prompt in a fresh OpenCode session:

> Agentic compatibility probe. You MUST call the read tool on package.json in the current directory. After receiving the tool result, reply with exactly AGENTIC_OK. Do not answer before calling the tool.

A model passed only when OpenCode observed both:

1. A completed `read` tool call.
2. A subsequent model response containing exactly `AGENTIC_OK`.

The probe used the plugin's normal dynamically discovered `bifrost` provider configuration. Memento was disabled for the probe subprocesses to keep the test focused on the model-to-tool-to-model loop. Each subprocess had a 120-second timeout.

This is a basic compatibility test, not a quality benchmark. A pass proves that the model can complete one OpenCode tool round trip through the configured adapter. It does not prove strong coding ability, reliable tool selection, or suitability as a default agent.

## Result Summary

### Definite Discovery False Positives

These 21 models were exposed by the plugin version under test but do not work correctly in the tested OpenCode configuration. The accompanying discovery change excludes them by exact model ID.

| Models | Failure |
| --- | --- |
| `gemini/gemini-2.5-flash`, `gemini/gemini-2.5-flash-lite`, `gemini/gemini-2.5-pro` | Provider reports that the model is no longer available to new users. |
| `openai/gpt-3.5-turbo`, `openai/gpt-3.5-turbo-0125`, `openai/gpt-3.5-turbo-16k` | OpenCode's messages and function definitions exceed the 16,385-token context. |
| `openai/gpt-4`, `openai/gpt-4-0613` | Requested completion plus prompt exceeds the 8,192-token context. |
| `openai/gpt-5-pro`, `openai/gpt-5-pro-2025-10-06` | Responses API only; the plugin's generic adapter uses Chat Completions. |
| `openai/gpt-5.2-pro`, `openai/gpt-5.2-pro-2025-12-11` | Not supported by Chat Completions. |
| `openai/gpt-5.3-codex` | Responses API only. |
| `openai/gpt-5.4-pro`, `openai/gpt-5.4-pro-2026-03-05` | Not supported by Chat Completions. |
| `openai/gpt-5.5-pro`, `openai/gpt-5.5-pro-2026-04-23` | Not supported by Chat Completions. |
| `openai/o1-pro`, `openai/o1-pro-2025-03-19` | Responses API only. |
| `openai/o3-pro`, `openai/o3-pro-2025-06-10` | Not supported by Chat Completions. |

### Inconclusive or Agentic Failure

| Model | Result |
| --- | --- |
| `anthropic/claude-opus-4-7` | Request completed and incurred cost, but produced neither the required tool call nor the final marker. Retest before permanently excluding it. |
| `gemini/gemma-4-26b-a4b-it` | Provider quota error. Compatibility was not established. |
| `gemini/gemma-4-31b-it` | Provider quota error. Compatibility was not established. |

## Per-Model Session Ledger

Token and cost values below are persisted OpenCode session totals. `Cache` is cache-read tokens; every suite session recorded zero cache-write tokens.

| # | Model | Result | Seconds | Cost USD | Input | Output | Reasoning | Cache | OpenCode session |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `anthropic/claude-fable-5` | Pass | 9.9 | 0.517220 | 51,257 | 93 | 0 | 0 | `ses_ea5221a48ffeONQnlMx5iVq9q5` |
| 2 | `anthropic/claude-fable-5-1` | Pass | 7.5 | 0.517260 | 51,261 | 93 | 0 | 0 | `ses_ea52217d9ffeMzS429VI74clev` |
| 3 | `anthropic/claude-haiku-5-5` | Pass | 7.0 | 0.005173 | 51,265 | 93 | 0 | 0 | `ses_ea5221876ffeADdGH4SV85zDhS` |
| 4 | `anthropic/claude-opus-4-5-20251101` | Pass | 8.0 | 0.194465 | 38,458 | 87 | 0 | 0 | `ses_ea5221a82ffebYjc5ujbWYLrw7` |
| 5 | `anthropic/claude-opus-4-6` | Pass | 12.7 | 0.194420 | 38,444 | 88 | 0 | 0 | `ses_ea521fd40ffe9QOj7n9JTkBqlg` |
| 6 | `anthropic/claude-opus-4-7` | Agent loop failed | 11.6 | 0.130230 | 25,686 | 72 | 0 | 0 | `ses_ea521fc93ffezaEolOCBmrgNXZ` |
| 7 | `anthropic/claude-opus-4-8` | Pass | 7.8 | 0.258980 | 51,276 | 104 | 0 | 0 | `ses_ea521fa93ffeA0JoofYG4eRS7z` |
| 8 | `anthropic/claude-opus-5` | Pass | 6.2 | 0.259820 | 51,249 | 94 | 49 | 0 | `ses_ea521f571ffes0tPGwQ6KlhUWT` |
| 9 | `anthropic/claude-opus-5-5` | Pass | 8.6 | 0.206904 | 51,261 | 93 | 0 | 0 | `ses_ea521dc0cffegpLxxkAtIYNUyW` |
| 10 | `anthropic/claude-sonnet-4-6` | Pass | 7.1 | 0.116664 | 38,448 | 88 | 0 | 0 | `ses_ea521de16ffeyoUoooeg9V3yot` |
| 11 | `anthropic/claude-sonnet-5` | Pass | 5.0 | 0.103716 | 51,393 | 93 | 0 | 0 | `ses_ea521d322ffee7HHGGxTlqpZGn` |
| 12 | `anthropic/claude-sonnet-5-5` | Pass | 7.5 | 0.103468 | 51,269 | 93 | 0 | 0 | `ses_ea521cd90ffeohkGzUpshUDFGz` |
| 13 | `dev.meta.ai/muse-spark-1.1` | Pass | 9.4 | 0.000000 | 17,778 | 100 | 733 | 17,265 | `ses_ea521c2e2ffe2qYVdAK1Arg796` |
| 14 | `dev.meta.ai/muse-spark-1.2` | Pass | 6.2 | 0.000000 | 35,040 | 97 | 199 | 0 | `ses_ea521bf11ffeAh6YIxiCH73V5E` |
| 15 | `dev.meta.ai/muse-spark-1.3` | Pass | 6.4 | 0.000000 | 35,039 | 96 | 67 | 0 | `ses_ea521bd36ffeG3f47MOFdS2zu4` |
| 16 | `gemini/gemini-2.5-flash` | Unavailable | 74.7 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea521b061ffe0LYbLB3IuriJ0D` |
| 17 | `gemini/gemini-2.5-flash-lite` | Unavailable | 79.3 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea521a3ddffeEAGhk4IocltCY3` |
| 18 | `gemini/gemini-2.5-pro` | Unavailable | 75.2 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea521a169ffeff5B3D1OiHJovY` |
| 19 | `gemini/gemini-3-flash-preview` | Pass | 6.4 | 0.012938 | 23,987 | 43 | 0 | 16,319 | `ses_ea5219ae9ffe4nYCevw1t6rkxH` |
| 20 | `gemini/gemini-3.1-flash-lite` | Pass | 5.9 | 0.006014 | 21,962 | 43 | 0 | 18,352 | `ses_ea5218374ffeow89uzPZwS0Ovg` |
| 21 | `gemini/gemini-3.1-pro-preview` | Pass | 9.9 | 0.053951 | 22,762 | 43 | 362 | 17,833 | `ses_ea5216dd0ffeHUmJr9GIYwXiLa` |
| 22 | `gemini/gemini-3.1-pro-preview-customtools` | Pass | 10.1 | 0.052196 | 22,893 | 43 | 198 | 17,590 | `ses_ea521463bffeb8cVntVgRYWcnC` |
| 23 | `gemini/gemini-3.5-flash` | Pass | 6.4 | 0.038565 | 22,614 | 43 | 176 | 17,819 | `ses_ea521207dffewYUggnFL65bwuZ` |
| 24 | `gemini/gemini-3.5-flash-lite` | Pass | 6.4 | 0.007247 | 21,964 | 43 | 0 | 18,350 | `ses_ea521043effetVYTkx2EryUDIB` |
| 25 | `gemini/gemini-3.6-flash` | Pass | 7.2 | 0.019413 | 22,682 | 43 | 241 | 17,819 | `ses_ea520ee34ffeYFZA2NSU4QP4NI` |
| 26 | `gemini/gemini-3.7-flash` | Pass | 6.6 | 0.018364 | 22,488 | 43 | 0 | 17,818 | `ses_ea520d296ffe0PU5IkmGXdaXio` |
| 27 | `gemini/gemini-3.8-flash` | Pass | 8.9 | 0.019003 | 22,611 | 43 | 146 | 17,819 | `ses_ea520b6a1ffeLZPcqhYVnTcO2A` |
| 28 | `gemini/gemini-4-argon` | Pass | 15.5 | 0.082038 | 40,504 | 53 | 50 | 0 | `ses_ea520947dfferpfctVcW19N5mJ` |
| 29 | `gemini/gemini-flash-latest` | Pass | 11.7 | 0.019522 | 22,365 | 43 | 325 | 18,241 | `ses_ea5208c96ffecJflnFAlse8cnR` |
| 30 | `gemini/gemini-flash-lite-latest` | Pass | 5.9 | 0.005042 | 13,798 | 43 | 0 | 26,508 | `ses_ea5207dffffejTB0Oo2k271ggw` |
| 31 | `gemini/gemini-pro-latest` | Pass | 9.3 | 0.053043 | 22,747 | 43 | 289 | 17,824 | `ses_ea5206fc8ffed6Q9E3kKLq5w3H` |
| 32 | `gemini/gemma-4-26b-a4b-it` | Quota error | 71.7 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea5206608ffehpOJCENYUnMxB2` |
| 33 | `gemini/gemma-4-31b-it` | Quota error | 75.3 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea5205f8effeTaHsXctrwLMsBL` |
| 34 | `openai/chat-latest` | Pass | 6.7 | 0.092400 | 16,610 | 45 | 0 | 16,000 | `ses_ea5205580ffenEkeGRqeo90F1L` |
| 35 | `openai/gpt-3.5-turbo` | Context failure | 120.1 | 0.024895 | 31,709 | 6,027 | 0 | 0 | `ses_ea5204dd3ffeG9Cw3vdXDDxEf2` |
| 36 | `openai/gpt-3.5-turbo-0125` | Context failure | 120.1 | 0.026344 | 32,393 | 6,765 | 0 | 0 | `ses_ea5203fbaffe6fyiPMB0HxAkwp` |
| 37 | `openai/gpt-3.5-turbo-16k` | Context failure | 120.1 | 0.126848 | 33,980 | 6,227 | 0 | 0 | `ses_ea51f4da9ffe7xrfm5BVhkxyHM` |
| 38 | `openai/gpt-4` | Context failure | 4.6 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51f3b6fffeMb9YzxMHhDGbDo` |
| 39 | `openai/gpt-4-0613` | Context failure | 6.4 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51f2269ffe4LQbBvyKojzsZT` |
| 40 | `openai/gpt-4-turbo` | Pass | 16.9 | 0.342870 | 34,185 | 34 | 0 | 0 | `ses_ea51f0caeffeeD55djodOQbaha` |
| 41 | `openai/gpt-4-turbo-2024-04-09` | Pass | 13.1 | 0.343150 | 34,213 | 34 | 0 | 0 | `ses_ea51ece64ffeO4DbJAaP4HmwXs` |
| 42 | `openai/gpt-4.1` | Pass | 5.8 | 0.042876 | 17,158 | 38 | 0 | 16,512 | `ses_ea51e9916ffeGks2r7EwqFkbHN` |
| 43 | `openai/gpt-4.1-2025-04-14` | Pass | 6.7 | 0.042932 | 17,186 | 38 | 0 | 16,512 | `ses_ea51e814effevtEHiITVWFkKbc` |
| 44 | `openai/gpt-4.1-mini` | Pass | 5.1 | 0.008577 | 17,162 | 38 | 0 | 16,512 | `ses_ea51e7838ffe3KnvEBfU1zofJQ` |
| 45 | `openai/gpt-4.1-mini-2025-04-14` | Pass | 5.9 | 0.008559 | 17,085 | 46 | 0 | 16,512 | `ses_ea51e6773ffeoLXtxchIs0guor` |
| 46 | `openai/gpt-4.1-nano` | Pass | 7.0 | 0.002136 | 17,148 | 20 | 0 | 16,512 | `ses_ea51e62cfffe02Ji4CWZMi83Og` |
| 47 | `openai/gpt-4.1-nano-2025-04-14` | Pass | 5.7 | 0.002138 | 17,176 | 20 | 0 | 16,512 | `ses_ea51e6223ffeKdsK3mj1znv31U` |
| 48 | `openai/gpt-4o` | Pass | 7.0 | 0.063905 | 17,154 | 38 | 0 | 16,512 | `ses_ea51e4f94ffe2YOMxCDutKsvUt` |
| 49 | `openai/gpt-4o-2024-05-13` | Pass | 7.4 | 0.169040 | 33,694 | 38 | 0 | 0 | `ses_ea51e4e3effeMLUCsRQ8wrgqok` |
| 50 | `openai/gpt-4o-2024-08-06` | Pass | 7.6 | 0.061735 | 15,390 | 38 | 0 | 18,304 | `ses_ea51e4890ffeHUcapLn7pFMy0I` |
| 51 | `openai/gpt-4o-2024-11-20` | Pass | 5.9 | 0.063750 | 17,164 | 20 | 0 | 16,512 | `ses_ea51e3848ffeAeL34yewpIJLl1` |
| 52 | `openai/gpt-4o-mini` | Pass | 6.7 | 0.003835 | 17,158 | 38 | 0 | 16,512 | `ses_ea51e2d5fffeu8a6xKT3UYrdEI` |
| 53 | `openai/gpt-4o-mini-2024-07-18` | Pass | 5.2 | 0.003839 | 17,186 | 38 | 0 | 16,512 | `ses_ea51e2f61ffevcyW79m7QxLo2E` |
| 54 | `openai/gpt-5` | Pass | 11.8 | 0.027114 | 16,640 | 49 | 384 | 15,872 | `ses_ea51e20f5ffeDd1rfSENG3myTN` |
| 55 | `openai/gpt-5-2025-08-07` | Pass | 12.7 | 0.025421 | 15,132 | 49 | 384 | 17,408 | `ses_ea51e1862ffejjfWhFcYmgdBeB` |
| 56 | `openai/gpt-5-mini` | Pass | 8.1 | 0.005168 | 16,644 | 49 | 256 | 15,872 | `ses_ea51e181cffe75UYPwq496lZ0E` |
| 57 | `openai/gpt-5-mini-2025-08-07` | Pass | 9.2 | 0.005114 | 15,149 | 62 | 384 | 17,408 | `ses_ea51df5b1ffeIFM3nlq7p90hJ4` |
| 58 | `openai/gpt-5-nano` | Pass | 11.3 | 0.001271 | 16,657 | 64 | 832 | 15,872 | `ses_ea51df091ffeXj4jQ324wzB5XI` |
| 59 | `openai/gpt-5-nano-2025-08-07` | Pass | 9.8 | 0.001126 | 15,149 | 64 | 640 | 17,408 | `ses_ea51dea2affe1sE4lDQlrhfVf7` |
| 60 | `openai/gpt-5-pro` | Endpoint failure | 77.4 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51dd468ffeqcnOu1yGiU4W0o` |
| 61 | `openai/gpt-5-pro-2025-10-06` | Endpoint failure | 74.8 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51dc466ffe6A6OAjOL7P77sC` |
| 62 | `openai/gpt-5.1` | Pass | 5.8 | 0.023524 | 16,648 | 49 | 24 | 15,872 | `ses_ea51dc419ffeIOGNmeN6P2fDkI` |
| 63 | `openai/gpt-5.1-2025-11-13` | Pass | 5.3 | 0.021857 | 15,012 | 49 | 41 | 17,536 | `ses_ea51dae6afferFacrima37Piru` |
| 64 | `openai/gpt-5.2` | Pass | 5.6 | 0.033242 | 16,648 | 49 | 46 | 15,872 | `ses_ea51d99ceffe1zA0II55a0rTt4` |
| 65 | `openai/gpt-5.2-2025-12-11` | Pass | 5.6 | 0.033109 | 16,676 | 49 | 33 | 15,872 | `ses_ea51d83afffeKG54wOStOxdFqH` |
| 66 | `openai/gpt-5.2-pro` | Endpoint failure | 78.0 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51d7920ffe9AkOFBBe2el0Nq` |
| 67 | `openai/gpt-5.2-pro-2025-12-11` | Endpoint failure | 72.8 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51d6d8bffeu4FZfrDTId3GV5` |
| 68 | `openai/gpt-5.3-codex` | Endpoint failure | 72.0 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51ca442ffebbvdDtU5rHsbwN` |
| 69 | `openai/gpt-5.4` | Pass | 6.4 | 0.046941 | 16,487 | 47 | 70 | 15,872 | `ses_ea51ca06fffeUUSmBEpKjPi3My` |
| 70 | `openai/gpt-5.4-2026-03-05` | Pass | 8.2 | 0.034324 | 10,883 | 47 | 69 | 21,504 | `ses_ea51c8a3effe9Te4NGBTSamdM2` |
| 71 | `openai/gpt-5.4-mini` | Pass | 5.3 | 0.014013 | 16,491 | 47 | 54 | 15,872 | `ses_ea51c677affelq5JzZvfvAgg1y` |
| 72 | `openai/gpt-5.4-mini-2026-03-17` | Pass | 5.6 | 0.011448 | 12,807 | 47 | 36 | 19,584 | `ses_ea51c5342ffeeyvu4E3a1wtEq8` |
| 73 | `openai/gpt-5.4-nano` | Pass | 5.7 | 0.003686 | 16,504 | 54 | 0 | 15,872 | `ses_ea51c5195ffevw3VqFWf5lmwwx` |
| 74 | `openai/gpt-5.4-nano-2026-03-17` | Pass | 5.5 | 0.002742 | 10,896 | 52 | 54 | 21,504 | `ses_ea51c4a16ffefV7roTrGTKNvUa` |
| 75 | `openai/gpt-5.4-pro` | Endpoint failure | 74.7 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51c3bbaffe2HRzN424v14DJz` |
| 76 | `openai/gpt-5.4-pro-2026-03-05` | Endpoint failure | 72.0 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51c3791ffeJHG2RQ4js9gHx5` |
| 77 | `openai/gpt-5.5` | Pass | 7.4 | 0.092201 | 16,487 | 47 | 14 | 15,872 | `ses_ea51c3113ffeQiBUHxHMlsdidt` |
| 78 | `openai/gpt-5.5-2026-04-23` | Pass | 5.8 | 0.066517 | 10,883 | 45 | 0 | 21,504 | `ses_ea51c17a1ffesQb1PUEf3f9ahw` |
| 79 | `openai/gpt-5.5-pro` | Endpoint failure | 73.3 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51c000effeUlkavK1Am3mZ1q` |
| 80 | `openai/gpt-5.5-pro-2026-04-23` | Endpoint failure | 75.0 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51b8acdffeKCdVTeRlCL6S9b` |
| 81 | `openai/gpt-5.6-luna` | Pass | 4.9 | 0.003656 | 16,417 | 45 | 0 | 15,950 | `ses_ea51b21ffffeqsuHm3cCkWn6mq` |
| 82 | `openai/gpt-5.6-sol` | Pass | 6.6 | 0.072939 | 16,415 | 45 | 0 | 15,948 | `ses_ea51b18a3ffe8lQZXrgaXxu7s5` |
| 83 | `openai/gpt-5.6-terra` | Pass | 6.0 | 0.036564 | 16,417 | 45 | 0 | 15,950 | `ses_ea51b0b17ffeSbylVclj777nec` |
| 84 | `openai/gpt-6-astra` | Pass | 6.5 | 0.170699 | 15,356 | 45 | 0 | 14,889 | `ses_ea51b01adffelTOKM2YnmtGXbt` |
| 85 | `openai/gpt-6-luna` | Pass | 6.4 | 0.001707 | 15,356 | 45 | 0 | 14,889 | `ses_ea51af42dffemBxe9HyKrNYm4D` |
| 86 | `openai/gpt-6-sol` | Pass | 6.3 | 0.034135 | 15,354 | 45 | 0 | 14,887 | `ses_ea51ae5c1ffeUY6Zq4ALWiiLfq` |
| 87 | `openai/gpt-6.1-sol` | Pass | 6.7 | 0.032655 | 15,358 | 45 | 0 | 14,891 | `ses_ea51ae078ffedH1ou9Qbs7ooBW` |
| 88 | `openai/o1` | Pass | 9.4 | 0.404400 | 17,148 | 69 | 320 | 16,512 | `ses_ea51adb2effe6cWTDyKU1FoNOV` |
| 89 | `openai/o1-2024-12-17` | Pass | 8.2 | 0.382500 | 15,256 | 65 | 192 | 18,432 | `ses_ea51acca2ffeWtKvPbgmhj2k7r` |
| 90 | `openai/o1-pro` | Endpoint failure | 80.1 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51ac5feffeUTgd46hao3nnZn` |
| 91 | `openai/o1-pro-2025-03-19` | Endpoint failure | 74.5 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51ab9f0ffe3jBWJOdHWfwqXN` |
| 92 | `openai/o3` | Pass | 5.7 | 0.043028 | 17,154 | 58 | 0 | 16,512 | `ses_ea51aafecffe3Vx4N5oIUZO3u3` |
| 93 | `openai/o3-2025-04-16` | Pass | 5.8 | 0.040396 | 15,390 | 58 | 0 | 18,304 | `ses_ea51a9a12ffehF4Ox4zP8og8CQ` |
| 94 | `openai/o3-mini` | Pass | 6.6 | 0.029187 | 17,398 | 60 | 192 | 16,256 | `ses_ea51a808bffeLrCneAlOMcpTb3` |
| 95 | `openai/o3-mini-2025-01-31` | Pass | 7.5 | 0.027491 | 15,260 | 65 | 64 | 18,432 | `ses_ea51a6612ffeHDSjE4iAsnJiYV` |
| 96 | `openai/o3-pro` | Endpoint failure | 76.2 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51a65b9ffep4N10715Rvg4Di` |
| 97 | `openai/o3-pro-2025-06-10` | Endpoint failure | 72.0 | 0.000000 | 0 | 0 | 0 | 0 | `ses_ea51a4becffeRAVHNUM8aL4vR0` |
| 98 | `openai/o4-mini` | Pass | 12.0 | 0.024336 | 16,612 | 58 | 320 | 16,000 | `ses_ea5198b55ffeuE7i9lgeu3Qv96` |
| 99 | `openai/o4-mini-2025-04-16` | Pass | 13.4 | 0.025212 | 16,640 | 58 | 512 | 16,000 | `ses_ea5198704ffeN2zTbS7K1LessA` |

## Explicit Pricing Validation

After the sweep, the local `credibly-dev/opencode.json` override for `openai/gpt-5.6-sol` was reduced to the single test model and populated with the live Bifrost rates:

| Token class | OpenCode rate per million tokens |
| --- | ---: |
| Input | $4.00 |
| Output | $20.00 |
| Cache read | $0.40 |
| Cache write | $5.00 |

The validation session `ses_ea4f1ae33ffeOwEV0C53vMw0as` recorded:

| Cost | Input | Output | Reasoning | Cache read | Cache write |
| ---: | ---: | ---: | ---: | ---: | ---: |
| $0.0888206 | 6 | 44 | 0 | 15,854 | 16,315 |

Its two OpenCode steps reported `$0.080022` and `$0.0087986`, which sum exactly to the persisted session total. This confirms that OpenCode uses the flat `cache_read` and `cache_write` rates and displays nonzero session spend for the explicit override.

## Excluded-Model Audit

The plugin version under test had 126 exclusions, which were not all empirically proven failures. The filter is deliberately conservative because Bifrost does not expose a universal tool-calling capability flag.

| Exclusion source | Count | Confidence |
| --- | ---: | --- |
| Catalog marks model deprecated | 27 | High. These should remain excluded without additional live spending. |
| Name matches a specialized capability | 95 | Mixed. Most are clearly image, audio, embedding, realtime, moderation, music, video, search, transcription, or other nonstandard models. Some text-capable specialized models were excluded heuristically. |
| Model family is not on the allowlist | 4 | Mixed. Two are legacy completion models, and two Meta models required direct testing. |

### Directly Tested Excluded Models

| Model | Result | Interpretation |
| --- | --- | --- |
| `dev.meta.ai/muse-wonder-1.0` | Passed the complete tool loop | Confirmed false negative in the current filter. Consider admitting it if its general coding behavior is acceptable. |
| `gemini/gemini-robotics-er-2-preview` | Passed the complete tool loop | Technically agentic through OpenCode, but a basic read-tool pass does not establish that a robotics-specialized model belongs in the general coding selector. |
| `dev.meta.ai/sam-3.1` | Returned no usable output | Known nonfunctional for this OpenCode probe. |
| `gemini/antigravity-preview-latest` | HTTP 400: function calling is not enabled | Known incompatible with the current agentic tool loop. |
| `gemini/deep-research-preview-04-2026` | HTTP 400: Interactions API only | Known incompatible with the plugin's current adapter. |
| `gemini/gemini-omni-1.1-flash` | HTTP 400: Interactions API only | Known incompatible with the plugin's current adapter. |

### What Is Known Versus Assumed

The deprecated exclusions are catalog-driven facts. Most modality exclusions are supported by their names and advertised methods, such as `embedContent`, `bidiGenerateContent`, `bidiGenerateMusic`, or `predictLongRunning`, which do not match OpenCode's normal text-and-tools request flow.

The broad name filter is still an assumption for models that expose `generateContent` despite a specialized name. The two confirmed false negatives above demonstrate that a name match alone does not prove non-functionality. The safe policy is:

1. Continue excluding deprecated and clearly non-text endpoint families.
2. Keep known endpoint-incompatible models excluded.
3. Probe new or ambiguous `generateContent` models before admitting or rejecting them.
4. Treat a basic tool-loop pass as a compatibility gate, not a quality endorsement.

## Recommended Discovery Changes

1. Exclude the 21 definite false positives listed above from dynamic discovery, as implemented by the accompanying exact-ID denylist, or later route Responses-only models through an appropriate native adapter before exposing them again.
2. Leave both quota-blocked Gemma models unresolved until they can be tested without a quota error.
3. Retest Claude Opus 4.7 before changing its discovery status.
4. Consider admitting Muse Wonder 1.0 after a broader coding/tool reliability check.
5. Keep Robotics ER 2 Preview excluded unless specialized robotics use in OpenCode is intentional.
