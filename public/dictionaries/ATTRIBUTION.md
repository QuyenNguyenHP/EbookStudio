# English IPA data

Source: https://github.com/open-dict-data/ipa-dict
Downloaded: 2026-10-25
Data: data/en_US.txt (General American English), 125,927 distinct entries.

`en-US.json` is a conversion of the accompanying `en-US.txt`: split each line on the first tab, lowercase the word key, retain its IPA value. Multiple pronunciations are retained; no context-dependent pronunciation is inferred.

ipa-dict is Copyright (c) 2016 dohliam, MIT licensed; see LICENSE-ipa-dict.txt and README-ipa-dict.md.
English US data is based on https://github.com/lingz/cmudict-ipa (MIT), with stress markers added using https://github.com/kylebgorman/syllabify, as credited by ipa-dict.
