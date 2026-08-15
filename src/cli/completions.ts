// Shell-completion scripts for tabook (`tabook --completion bash|zsh`).
//
// Generated from the same source-of-truth registries the app uses
// (COMMANDS/COMMAND_NAMES, OPDS_SUBS/LIBRARY_SUBS, THEMES), so the scripts
// can never drift from the actual command surface.
import { themeNames } from '../themes/themes.js';

const CLI_OPTIONS = [
  '--library',
  '--theme',
  '--config',
  '--man',
  '--completion',
  '--version',
  '--help',
];

function quoteList(items: string[]): string {
  return items.map((s) => `'${s.replace(/'/g, "'\\''")}'`).join(' ');
}

/** A bash completion script for tabook. */
export function bashCompletion(): string {
  // Theme names are single tokens (no spaces), so a plain space-joined list
  // is safe inside -W "...".
  const themes = themeNames().join(' ');
  const options = CLI_OPTIONS.join(' ');
  return `# tabook bash completion
# Source this file, or install it as:
#   /usr/share/bash-completion/completions/tabook
_tabook() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD - 1]}"
  case "\${prev}" in
    --theme)
      COMPREPLY=($(compgen -W "${themes}" -- "\${cur}"))
      return
      ;;
    --config)
      COMPREPLY=($(compgen -f -- "\${cur}"))
      return
      ;;
    --completion)
      COMPREPLY=($(compgen -W 'bash zsh' -- "\${cur}"))
      return
      ;;
  esac
  case "\${cur}" in
    -*)
      COMPREPLY=($(compgen -W '${options}' -- "\${cur}"))
      ;;
    *)
      COMPREPLY=($(compgen -f -- "\${cur}"))
      ;;
  esac
}
complete -F _tabook tabook
`;
}

/** A zsh completion script for tabook. */
export function zshCompletion(): string {
  const themes = quoteList(themeNames());
  return `#compdef tabook
# tabook zsh completion
# Install this file into a directory on your $fpath, for example:
#   /usr/share/zsh/site-functions/_tabook
_tabook() {
  local -a themes
  themes=(${themes})
  _arguments \\
    '(-h --help)'{-h,--help}'[output usage information]' \\
    '(-V --version)'{-V,--version}'[output the version number]' \\
    '--library[open the library view]' \\
    '--theme[theme to use, overriding the config]:theme:(${themes})' \\
    '--config[path to the config file]:config file:_files' \\
    '--man[print the man page to stdout]' \\
    '--completion[print a bash or zsh completion script]:shell:(bash zsh)' \\
    '*:book file or library folder:_files'
}
_tabook "$@"
`;
}
