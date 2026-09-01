#!/bin/bash

# A local token is optional; release-it can still use credentials supplied by CI.
if [[ -r .env ]]; then
  while IFS= read -r environment_entry; do
    if [[ $environment_entry == GITHUB_TOKEN=* ]]; then
      export "$environment_entry"
    fi
  done < .env
fi

exec npx release-it "$@" # Hand over exit status and signals without a wrapper process.
