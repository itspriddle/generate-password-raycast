# Generate Password

Raycast extension that generates passwords, passphrases, and PINs.

## Commands

- **Generate Password**, **Generate Passphrase**, **Generate PIN**: each one generates a value with your defaults and copies it, or pastes it if you chose that. An optional argument sets the length, word count, or digit count. Give each command its own alias or hotkey.
- **Password Generator**: previews several values. Pick the type from the dropdown and type a number to change the size. Adjust other options from the action panel (⌘K):

| Shortcut    | Action                                                   |
| ----------- | -------------------------------------------------------- |
| ⌥↑ / ⌥↓     | Increase / decrease length, words, or digits             |
| ⌥N ⌥S ⌥U ⌥L | Toggle numbers, symbols, uppercase, lowercase (password) |
| ⌥D ⌥U ⌥W    | Separator, uppercase words, word length (passphrase)     |
| ⌘⇧⌫         | Reset the current type to your preferences               |
| ⌘R          | Regenerate                                               |

Changes made in the generator are remembered between launches. Defaults come from the extension preferences.

## Word list

Passphrases use the [EFF Large Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) by the Electronic Frontier Foundation, licensed under [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/). The dice-roll column has been removed. You can set a custom list in preferences.
