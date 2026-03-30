/**
 * CLI completion specifications for Smart Autocomplete.
 *
 * Each spec describes a top-level command, its subcommands, and their flags.
 * Flags include short descriptions shown inline in the dropdown.
 */

export interface FlagSpec {
  name: string;       // e.g. "--message" or "-m"
  alias?: string;     // e.g. "-m" is alias for "--message"
  description: string;
  takesValue?: boolean; // flag expects a value argument
}

export interface SubcommandSpec {
  name: string;
  description: string;
  flags?: FlagSpec[];
  subcommands?: SubcommandSpec[]; // nested subcommands (e.g. git remote add)
}

export interface CommandSpec {
  name: string;
  description: string;
  subcommands?: SubcommandSpec[];
  flags?: FlagSpec[];  // global flags
}

// ── Git ──────────────────────────────────────────────────────────────

const gitSpec: CommandSpec = {
  name: 'git',
  description: 'Distributed version control system',
  flags: [
    { name: '--version', description: 'Print git version' },
    { name: '--help', description: 'Show help' },
    { name: '-C', description: 'Run as if started in <path>', takesValue: true },
  ],
  subcommands: [
    {
      name: 'init',
      description: 'Create an empty Git repository',
      flags: [
        { name: '--bare', description: 'Create a bare repository' },
        { name: '-b', alias: '--initial-branch', description: 'Initial branch name', takesValue: true },
      ],
    },
    {
      name: 'clone',
      description: 'Clone a repository into a new directory',
      flags: [
        { name: '--depth', description: 'Shallow clone depth', takesValue: true },
        { name: '--branch', alias: '-b', description: 'Branch to clone', takesValue: true },
        { name: '--single-branch', description: 'Clone only one branch' },
        { name: '--recurse-submodules', description: 'Initialize submodules' },
        { name: '--shallow-submodules', description: 'Shallow clone submodules' },
      ],
    },
    {
      name: 'add',
      description: 'Add file contents to the index',
      flags: [
        { name: '-A', alias: '--all', description: 'Add all changes' },
        { name: '-p', alias: '--patch', description: 'Interactively stage hunks' },
        { name: '-n', alias: '--dry-run', description: 'Dry run' },
        { name: '-f', alias: '--force', description: 'Allow adding ignored files' },
        { name: '-u', alias: '--update', description: 'Update tracked files only' },
      ],
    },
    {
      name: 'commit',
      description: 'Record changes to the repository',
      flags: [
        { name: '-m', alias: '--message', description: 'Commit message', takesValue: true },
        { name: '-a', alias: '--all', description: 'Stage all modified files' },
        { name: '--amend', description: 'Amend the previous commit' },
        { name: '--no-edit', description: 'Use previous commit message' },
        { name: '-s', alias: '--signoff', description: 'Add Signed-off-by' },
        { name: '--allow-empty', description: 'Allow empty commit' },
        { name: '--fixup', description: 'Fixup commit for rebase', takesValue: true },
      ],
    },
    {
      name: 'push',
      description: 'Update remote refs',
      flags: [
        { name: '-u', alias: '--set-upstream', description: 'Set upstream for branch' },
        { name: '-f', alias: '--force', description: 'Force push' },
        { name: '--force-with-lease', description: 'Safe force push' },
        { name: '--tags', description: 'Push all tags' },
        { name: '--delete', description: 'Delete remote branch' },
        { name: '--dry-run', description: 'Dry run' },
      ],
    },
    {
      name: 'pull',
      description: 'Fetch and integrate with another repository',
      flags: [
        { name: '--rebase', description: 'Rebase instead of merge' },
        { name: '--no-rebase', description: 'Merge (default)' },
        { name: '--ff-only', description: 'Fast-forward only' },
        { name: '--autostash', description: 'Stash before, pop after' },
      ],
    },
    {
      name: 'status',
      description: 'Show the working tree status',
      flags: [
        { name: '-s', alias: '--short', description: 'Short format' },
        { name: '-b', alias: '--branch', description: 'Show branch info' },
        { name: '--porcelain', description: 'Machine-readable output' },
      ],
    },
    {
      name: 'log',
      description: 'Show commit logs',
      flags: [
        { name: '--oneline', description: 'Compact one-line format' },
        { name: '--graph', description: 'Draw commit graph' },
        { name: '--all', description: 'Show all branches' },
        { name: '-n', description: 'Limit number of commits', takesValue: true },
        { name: '--stat', description: 'Show diffstat' },
        { name: '--author', description: 'Filter by author', takesValue: true },
        { name: '--since', description: 'Show commits after date', takesValue: true },
        { name: '--pretty', description: 'Format output', takesValue: true },
      ],
    },
    {
      name: 'diff',
      description: 'Show changes between commits, working tree, etc',
      flags: [
        { name: '--staged', alias: '--cached', description: 'Show staged changes' },
        { name: '--stat', description: 'Show diffstat' },
        { name: '--name-only', description: 'Show only file names' },
        { name: '--name-status', description: 'Show names and status' },
      ],
    },
    {
      name: 'branch',
      description: 'List, create, or delete branches',
      flags: [
        { name: '-a', alias: '--all', description: 'List all branches' },
        { name: '-d', alias: '--delete', description: 'Delete branch' },
        { name: '-D', description: 'Force delete branch' },
        { name: '-m', alias: '--move', description: 'Rename branch' },
        { name: '-r', alias: '--remotes', description: 'List remote branches' },
        { name: '--show-current', description: 'Print current branch' },
      ],
    },
    {
      name: 'checkout',
      description: 'Switch branches or restore working tree files',
      flags: [
        { name: '-b', description: 'Create and switch to new branch', takesValue: true },
        { name: '-B', description: 'Force create and switch', takesValue: true },
        { name: '--track', description: 'Set up tracking branch' },
        { name: '-f', alias: '--force', description: 'Force checkout' },
      ],
    },
    {
      name: 'switch',
      description: 'Switch branches',
      flags: [
        { name: '-c', alias: '--create', description: 'Create new branch', takesValue: true },
        { name: '-C', alias: '--force-create', description: 'Force create branch', takesValue: true },
        { name: '--detach', description: 'Detach HEAD' },
      ],
    },
    {
      name: 'merge',
      description: 'Join two or more development histories together',
      flags: [
        { name: '--no-ff', description: 'Create merge commit always' },
        { name: '--squash', description: 'Squash commits' },
        { name: '--abort', description: 'Abort merge' },
        { name: '--continue', description: 'Continue merge' },
      ],
    },
    {
      name: 'rebase',
      description: 'Reapply commits on top of another base tip',
      flags: [
        { name: '-i', alias: '--interactive', description: 'Interactive rebase' },
        { name: '--onto', description: 'Rebase onto branch', takesValue: true },
        { name: '--abort', description: 'Abort rebase' },
        { name: '--continue', description: 'Continue rebase' },
        { name: '--skip', description: 'Skip current patch' },
      ],
    },
    {
      name: 'stash',
      description: 'Stash changes in working directory',
      subcommands: [
        { name: 'push', description: 'Stash changes', flags: [
          { name: '-m', alias: '--message', description: 'Stash message', takesValue: true },
          { name: '-u', alias: '--include-untracked', description: 'Include untracked files' },
        ]},
        { name: 'pop', description: 'Apply and remove stash' },
        { name: 'apply', description: 'Apply stash without removing' },
        { name: 'list', description: 'List stashes' },
        { name: 'drop', description: 'Remove a stash' },
        { name: 'clear', description: 'Remove all stashes' },
        { name: 'show', description: 'Show stash contents' },
      ],
    },
    {
      name: 'remote',
      description: 'Manage set of tracked repositories',
      subcommands: [
        { name: 'add', description: 'Add a remote' },
        { name: 'remove', description: 'Remove a remote' },
        { name: 'rename', description: 'Rename a remote' },
        { name: 'show', description: 'Show remote info' },
        { name: 'set-url', description: 'Change remote URL' },
      ],
      flags: [
        { name: '-v', alias: '--verbose', description: 'Show remote URLs' },
      ],
    },
    {
      name: 'fetch',
      description: 'Download objects and refs from another repository',
      flags: [
        { name: '--all', description: 'Fetch all remotes' },
        { name: '--prune', description: 'Remove stale remote refs' },
        { name: '--tags', description: 'Fetch all tags' },
        { name: '--depth', description: 'Shallow fetch depth', takesValue: true },
      ],
    },
    {
      name: 'reset',
      description: 'Reset current HEAD to the specified state',
      flags: [
        { name: '--soft', description: 'Keep changes staged' },
        { name: '--mixed', description: 'Keep changes unstaged (default)' },
        { name: '--hard', description: 'Discard all changes' },
      ],
    },
    {
      name: 'restore',
      description: 'Restore working tree files',
      flags: [
        { name: '--staged', description: 'Unstage file' },
        { name: '--source', description: 'Restore from source', takesValue: true },
      ],
    },
    {
      name: 'tag',
      description: 'Create, list, delete or verify tags',
      flags: [
        { name: '-a', alias: '--annotate', description: 'Annotated tag' },
        { name: '-m', alias: '--message', description: 'Tag message', takesValue: true },
        { name: '-d', alias: '--delete', description: 'Delete tag' },
        { name: '-l', alias: '--list', description: 'List tags' },
      ],
    },
    {
      name: 'cherry-pick',
      description: 'Apply changes from existing commits',
      flags: [
        { name: '--no-commit', description: 'Apply without committing' },
        { name: '--abort', description: 'Abort cherry-pick' },
        { name: '--continue', description: 'Continue cherry-pick' },
      ],
    },
    {
      name: 'bisect',
      description: 'Binary search for the commit that introduced a bug',
      subcommands: [
        { name: 'start', description: 'Start bisection' },
        { name: 'bad', description: 'Mark commit as bad' },
        { name: 'good', description: 'Mark commit as good' },
        { name: 'reset', description: 'End bisection' },
        { name: 'skip', description: 'Skip commit' },
      ],
    },
    {
      name: 'worktree',
      description: 'Manage multiple working trees',
      subcommands: [
        { name: 'add', description: 'Create a new worktree' },
        { name: 'list', description: 'List worktrees' },
        { name: 'remove', description: 'Remove a worktree' },
        { name: 'prune', description: 'Prune stale worktrees' },
      ],
    },
    {
      name: 'config',
      description: 'Get and set repository or global options',
      flags: [
        { name: '--global', description: 'Use global config' },
        { name: '--local', description: 'Use repository config' },
        { name: '--list', description: 'List all settings' },
        { name: '--unset', description: 'Remove a setting' },
      ],
    },
    {
      name: 'show',
      description: 'Show various types of objects',
      flags: [
        { name: '--stat', description: 'Show diffstat' },
        { name: '--name-only', description: 'Show file names only' },
      ],
    },
    {
      name: 'clean',
      description: 'Remove untracked files from working tree',
      flags: [
        { name: '-f', alias: '--force', description: 'Force clean' },
        { name: '-d', description: 'Remove untracked directories too' },
        { name: '-n', alias: '--dry-run', description: 'Dry run' },
        { name: '-x', description: 'Remove ignored files too' },
      ],
    },
    {
      name: 'submodule',
      description: 'Initialize, update, or inspect submodules',
      subcommands: [
        { name: 'init', description: 'Initialize submodules' },
        { name: 'update', description: 'Update submodules', flags: [
          { name: '--init', description: 'Initialize if needed' },
          { name: '--recursive', description: 'Update recursively' },
        ]},
        { name: 'add', description: 'Add a submodule' },
        { name: 'status', description: 'Show submodule status' },
      ],
    },
  ],
};

// ── npm ──────────────────────────────────────────────────────────────

const npmSpec: CommandSpec = {
  name: 'npm',
  description: 'Node.js package manager',
  subcommands: [
    {
      name: 'install',
      description: 'Install packages',
      flags: [
        { name: '--save-dev', alias: '-D', description: 'Save as dev dependency' },
        { name: '--save-exact', alias: '-E', description: 'Save exact version' },
        { name: '--global', alias: '-g', description: 'Install globally' },
        { name: '--legacy-peer-deps', description: 'Ignore peer dep conflicts' },
        { name: '--force', description: 'Force installation' },
        { name: '--no-save', description: 'Do not save to package.json' },
      ],
    },
    { name: 'i', description: 'Install packages (alias)' },
    {
      name: 'run',
      description: 'Run a script defined in package.json',
      flags: [
        { name: '--silent', description: 'Suppress output' },
      ],
    },
    { name: 'start', description: 'Start the application' },
    { name: 'test', description: 'Run tests' },
    {
      name: 'init',
      description: 'Create a package.json file',
      flags: [
        { name: '-y', alias: '--yes', description: 'Accept all defaults' },
      ],
    },
    {
      name: 'uninstall',
      description: 'Remove a package',
      flags: [
        { name: '--global', alias: '-g', description: 'Remove global package' },
      ],
    },
    { name: 'update', description: 'Update packages' },
    { name: 'outdated', description: 'Check for outdated packages' },
    {
      name: 'publish',
      description: 'Publish a package to the registry',
      flags: [
        { name: '--access', description: 'Set access level (public/restricted)', takesValue: true },
        { name: '--tag', description: 'Publish with a dist-tag', takesValue: true },
        { name: '--dry-run', description: 'Dry run' },
      ],
    },
    { name: 'pack', description: 'Create a tarball from a package' },
    { name: 'audit', description: 'Run a security audit', flags: [
      { name: '--fix', description: 'Attempt to fix vulnerabilities' },
    ]},
    { name: 'ci', description: 'Clean install from lockfile' },
    { name: 'cache', description: 'Manipulate the packages cache', subcommands: [
      { name: 'clean', description: 'Clean the cache', flags: [
        { name: '--force', description: 'Force clean' },
      ]},
      { name: 'verify', description: 'Verify cache integrity' },
    ]},
    {
      name: 'link',
      description: 'Symlink a package folder',
    },
    { name: 'ls', description: 'List installed packages', flags: [
      { name: '--all', description: 'Show all packages' },
      { name: '--depth', description: 'Max depth', takesValue: true },
    ]},
    {
      name: 'version',
      description: 'Bump package version',
      subcommands: [
        { name: 'major', description: 'Bump major version' },
        { name: 'minor', description: 'Bump minor version' },
        { name: 'patch', description: 'Bump patch version' },
      ],
    },
    { name: 'exec', description: 'Run a command from a local or remote npm package' },
    { name: 'create', description: 'Create a new package' },
  ],
};

// ── npx ──────────────────────────────────────────────────────────────

const npxSpec: CommandSpec = {
  name: 'npx',
  description: 'Run a command from a local or remote npm package',
  flags: [
    { name: '-y', alias: '--yes', description: 'Skip confirmation prompt' },
    { name: '-p', alias: '--package', description: 'Package to install', takesValue: true },
  ],
};

// ── Docker ───────────────────────────────────────────────────────────

const dockerSpec: CommandSpec = {
  name: 'docker',
  description: 'Container platform',
  subcommands: [
    {
      name: 'run',
      description: 'Create and run a new container',
      flags: [
        { name: '-d', alias: '--detach', description: 'Run in background' },
        { name: '-p', alias: '--publish', description: 'Publish port (host:container)', takesValue: true },
        { name: '-v', alias: '--volume', description: 'Bind mount a volume', takesValue: true },
        { name: '--name', description: 'Assign a name', takesValue: true },
        { name: '-e', alias: '--env', description: 'Set environment variable', takesValue: true },
        { name: '--rm', description: 'Remove container when it exits' },
        { name: '-it', description: 'Interactive with TTY' },
        { name: '--network', description: 'Connect to a network', takesValue: true },
        { name: '-w', alias: '--workdir', description: 'Working directory inside container', takesValue: true },
      ],
    },
    {
      name: 'build',
      description: 'Build an image from a Dockerfile',
      flags: [
        { name: '-t', alias: '--tag', description: 'Tag the image', takesValue: true },
        { name: '-f', alias: '--file', description: 'Dockerfile path', takesValue: true },
        { name: '--no-cache', description: 'Do not use cache' },
        { name: '--platform', description: 'Set platform', takesValue: true },
        { name: '--build-arg', description: 'Set build argument', takesValue: true },
      ],
    },
    { name: 'ps', description: 'List containers', flags: [
      { name: '-a', alias: '--all', description: 'Show all containers' },
      { name: '-q', alias: '--quiet', description: 'Only show IDs' },
    ]},
    { name: 'images', description: 'List images', flags: [
      { name: '-a', alias: '--all', description: 'Show all images' },
      { name: '-q', alias: '--quiet', description: 'Only show IDs' },
    ]},
    { name: 'pull', description: 'Pull an image from a registry' },
    { name: 'push', description: 'Push an image to a registry' },
    { name: 'stop', description: 'Stop running containers' },
    { name: 'start', description: 'Start stopped containers' },
    { name: 'restart', description: 'Restart containers' },
    { name: 'rm', description: 'Remove containers', flags: [
      { name: '-f', alias: '--force', description: 'Force remove' },
    ]},
    { name: 'rmi', description: 'Remove images', flags: [
      { name: '-f', alias: '--force', description: 'Force remove' },
    ]},
    { name: 'exec', description: 'Run a command in a running container', flags: [
      { name: '-it', description: 'Interactive with TTY' },
      { name: '-d', alias: '--detach', description: 'Detached mode' },
      { name: '-w', alias: '--workdir', description: 'Working directory', takesValue: true },
    ]},
    { name: 'logs', description: 'Fetch container logs', flags: [
      { name: '-f', alias: '--follow', description: 'Follow log output' },
      { name: '--tail', description: 'Number of lines', takesValue: true },
      { name: '-t', alias: '--timestamps', description: 'Show timestamps' },
    ]},
    { name: 'inspect', description: 'Return low-level information on objects' },
    { name: 'network', description: 'Manage networks', subcommands: [
      { name: 'ls', description: 'List networks' },
      { name: 'create', description: 'Create a network' },
      { name: 'rm', description: 'Remove networks' },
      { name: 'inspect', description: 'Inspect a network' },
      { name: 'prune', description: 'Remove unused networks' },
    ]},
    { name: 'volume', description: 'Manage volumes', subcommands: [
      { name: 'ls', description: 'List volumes' },
      { name: 'create', description: 'Create a volume' },
      { name: 'rm', description: 'Remove volumes' },
      { name: 'inspect', description: 'Inspect a volume' },
      { name: 'prune', description: 'Remove unused volumes' },
    ]},
    { name: 'compose', description: 'Docker Compose', subcommands: [
      { name: 'up', description: 'Create and start services', flags: [
        { name: '-d', alias: '--detach', description: 'Detached mode' },
        { name: '--build', description: 'Build images before starting' },
      ]},
      { name: 'down', description: 'Stop and remove services', flags: [
        { name: '-v', alias: '--volumes', description: 'Remove volumes' },
        { name: '--rmi', description: 'Remove images', takesValue: true },
      ]},
      { name: 'ps', description: 'List services' },
      { name: 'logs', description: 'View service logs', flags: [
        { name: '-f', alias: '--follow', description: 'Follow output' },
      ]},
      { name: 'build', description: 'Build or rebuild services' },
      { name: 'pull', description: 'Pull service images' },
      { name: 'restart', description: 'Restart services' },
      { name: 'exec', description: 'Execute a command in a service' },
    ]},
    { name: 'system', description: 'Manage Docker', subcommands: [
      { name: 'prune', description: 'Remove unused data', flags: [
        { name: '-a', alias: '--all', description: 'Remove all unused images' },
        { name: '-f', alias: '--force', description: 'Skip confirmation' },
      ]},
      { name: 'df', description: 'Show disk usage' },
      { name: 'info', description: 'Display system info' },
    ]},
  ],
};

// ── kubectl ──────────────────────────────────────────────────────────

const kubectlSpec: CommandSpec = {
  name: 'kubectl',
  description: 'Kubernetes command-line tool',
  flags: [
    { name: '-n', alias: '--namespace', description: 'Namespace', takesValue: true },
    { name: '--context', description: 'Cluster context', takesValue: true },
    { name: '-o', alias: '--output', description: 'Output format (json/yaml/wide)', takesValue: true },
  ],
  subcommands: [
    { name: 'get', description: 'Display resources', subcommands: [
      { name: 'pods', description: 'List pods' },
      { name: 'services', description: 'List services' },
      { name: 'deployments', description: 'List deployments' },
      { name: 'nodes', description: 'List nodes' },
      { name: 'namespaces', description: 'List namespaces' },
      { name: 'configmaps', description: 'List config maps' },
      { name: 'secrets', description: 'List secrets' },
      { name: 'ingress', description: 'List ingresses' },
      { name: 'pv', description: 'List persistent volumes' },
      { name: 'pvc', description: 'List persistent volume claims' },
      { name: 'all', description: 'List all resources' },
    ], flags: [
      { name: '-l', alias: '--selector', description: 'Label selector', takesValue: true },
      { name: '-w', alias: '--watch', description: 'Watch for changes' },
      { name: '--all-namespaces', alias: '-A', description: 'All namespaces' },
    ]},
    { name: 'describe', description: 'Show details of a resource' },
    { name: 'create', description: 'Create a resource', flags: [
      { name: '-f', alias: '--filename', description: 'File to create from', takesValue: true },
    ]},
    { name: 'apply', description: 'Apply a configuration', flags: [
      { name: '-f', alias: '--filename', description: 'File to apply', takesValue: true },
      { name: '-k', alias: '--kustomize', description: 'Kustomize directory', takesValue: true },
      { name: '--dry-run', description: 'Dry run mode', takesValue: true },
    ]},
    { name: 'delete', description: 'Delete resources', flags: [
      { name: '-f', alias: '--filename', description: 'File with resources', takesValue: true },
      { name: '--all', description: 'Delete all in namespace' },
      { name: '--force', description: 'Force delete' },
    ]},
    { name: 'logs', description: 'Print pod logs', flags: [
      { name: '-f', alias: '--follow', description: 'Follow logs' },
      { name: '--tail', description: 'Lines to show', takesValue: true },
      { name: '-c', alias: '--container', description: 'Container name', takesValue: true },
      { name: '--previous', description: 'Previous terminated container' },
    ]},
    { name: 'exec', description: 'Execute command in a container', flags: [
      { name: '-it', description: 'Interactive with TTY' },
      { name: '-c', alias: '--container', description: 'Container name', takesValue: true },
    ]},
    { name: 'port-forward', description: 'Forward local port to a pod' },
    { name: 'scale', description: 'Scale a deployment', flags: [
      { name: '--replicas', description: 'Number of replicas', takesValue: true },
    ]},
    { name: 'rollout', description: 'Manage rollouts', subcommands: [
      { name: 'status', description: 'Show rollout status' },
      { name: 'history', description: 'Show rollout history' },
      { name: 'undo', description: 'Undo a rollout' },
      { name: 'restart', description: 'Restart a rollout' },
    ]},
    { name: 'config', description: 'Modify kubeconfig', subcommands: [
      { name: 'get-contexts', description: 'List contexts' },
      { name: 'use-context', description: 'Switch context' },
      { name: 'current-context', description: 'Show current context' },
      { name: 'view', description: 'Show kubeconfig' },
    ]},
    { name: 'top', description: 'Display resource usage', subcommands: [
      { name: 'nodes', description: 'Node resource usage' },
      { name: 'pods', description: 'Pod resource usage' },
    ]},
    { name: 'edit', description: 'Edit a resource' },
    { name: 'patch', description: 'Update fields of a resource' },
    { name: 'label', description: 'Update labels on a resource' },
    { name: 'annotate', description: 'Update annotations on a resource' },
  ],
};

// ── AWS CLI ──────────────────────────────────────────────────────────

const awsSpec: CommandSpec = {
  name: 'aws',
  description: 'Amazon Web Services CLI',
  flags: [
    { name: '--region', description: 'AWS region', takesValue: true },
    { name: '--profile', description: 'Named profile', takesValue: true },
    { name: '--output', description: 'Output format (json/table/text)', takesValue: true },
  ],
  subcommands: [
    { name: 's3', description: 'Amazon S3', subcommands: [
      { name: 'ls', description: 'List buckets or objects' },
      { name: 'cp', description: 'Copy objects', flags: [
        { name: '--recursive', description: 'Copy recursively' },
      ]},
      { name: 'mv', description: 'Move objects' },
      { name: 'rm', description: 'Delete objects', flags: [
        { name: '--recursive', description: 'Delete recursively' },
      ]},
      { name: 'sync', description: 'Sync directories', flags: [
        { name: '--delete', description: 'Delete files not in source' },
        { name: '--exclude', description: 'Exclude pattern', takesValue: true },
      ]},
      { name: 'mb', description: 'Make bucket' },
      { name: 'rb', description: 'Remove bucket' },
      { name: 'presign', description: 'Generate a presigned URL' },
    ]},
    { name: 'ec2', description: 'Amazon EC2', subcommands: [
      { name: 'describe-instances', description: 'List instances' },
      { name: 'start-instances', description: 'Start instances' },
      { name: 'stop-instances', description: 'Stop instances' },
      { name: 'terminate-instances', description: 'Terminate instances' },
      { name: 'describe-security-groups', description: 'List security groups' },
    ]},
    { name: 'ecs', description: 'Amazon ECS', subcommands: [
      { name: 'list-clusters', description: 'List clusters' },
      { name: 'list-services', description: 'List services' },
      { name: 'list-tasks', description: 'List tasks' },
      { name: 'describe-services', description: 'Describe services' },
      { name: 'update-service', description: 'Update a service' },
    ]},
    { name: 'lambda', description: 'AWS Lambda', subcommands: [
      { name: 'list-functions', description: 'List functions' },
      { name: 'invoke', description: 'Invoke a function' },
      { name: 'create-function', description: 'Create a function' },
      { name: 'update-function-code', description: 'Update function code' },
    ]},
    { name: 'iam', description: 'AWS IAM', subcommands: [
      { name: 'list-users', description: 'List IAM users' },
      { name: 'list-roles', description: 'List IAM roles' },
      { name: 'get-user', description: 'Get user info' },
    ]},
    { name: 'cloudformation', description: 'AWS CloudFormation', subcommands: [
      { name: 'deploy', description: 'Deploy a stack' },
      { name: 'describe-stacks', description: 'Describe stacks' },
      { name: 'delete-stack', description: 'Delete a stack' },
    ]},
    { name: 'logs', description: 'CloudWatch Logs', subcommands: [
      { name: 'describe-log-groups', description: 'List log groups' },
      { name: 'tail', description: 'Tail a log group' },
    ]},
    { name: 'sts', description: 'AWS STS', subcommands: [
      { name: 'get-caller-identity', description: 'Get current identity' },
      { name: 'assume-role', description: 'Assume an IAM role' },
    ]},
    { name: 'configure', description: 'Configure AWS CLI', subcommands: [
      { name: 'list', description: 'List configuration' },
      { name: 'set', description: 'Set a configuration value' },
      { name: 'get', description: 'Get a configuration value' },
    ]},
    { name: 'ssm', description: 'AWS Systems Manager', subcommands: [
      { name: 'start-session', description: 'Start a session' },
      { name: 'get-parameter', description: 'Get a parameter' },
      { name: 'put-parameter', description: 'Put a parameter' },
    ]},
  ],
};

// ── Brew ─────────────────────────────────────────────────────────────

const brewSpec: CommandSpec = {
  name: 'brew',
  description: 'Homebrew package manager',
  subcommands: [
    { name: 'install', description: 'Install a formula or cask', flags: [
      { name: '--cask', description: 'Install as cask' },
      { name: '--force', description: 'Force install' },
    ]},
    { name: 'uninstall', description: 'Uninstall a formula or cask' },
    { name: 'update', description: 'Fetch newest version of Homebrew' },
    { name: 'upgrade', description: 'Upgrade outdated packages' },
    { name: 'search', description: 'Search for formulae and casks' },
    { name: 'list', description: 'List installed formulae' },
    { name: 'info', description: 'Show formula info' },
    { name: 'doctor', description: 'Check system for issues' },
    { name: 'cleanup', description: 'Remove outdated downloads' },
    { name: 'services', description: 'Manage background services', subcommands: [
      { name: 'start', description: 'Start a service' },
      { name: 'stop', description: 'Stop a service' },
      { name: 'restart', description: 'Restart a service' },
      { name: 'list', description: 'List services' },
    ]},
    { name: 'tap', description: 'Add a third-party repository' },
    { name: 'untap', description: 'Remove a tapped repository' },
    { name: 'pin', description: 'Pin a formula to prevent upgrades' },
    { name: 'unpin', description: 'Unpin a formula' },
  ],
};

// ── pip ──────────────────────────────────────────────────────────────

const pipSpec: CommandSpec = {
  name: 'pip',
  description: 'Python package installer',
  subcommands: [
    { name: 'install', description: 'Install packages', flags: [
      { name: '-r', alias: '--requirement', description: 'Install from requirements file', takesValue: true },
      { name: '--upgrade', alias: '-U', description: 'Upgrade package' },
      { name: '--user', description: 'Install to user directory' },
      { name: '-e', alias: '--editable', description: 'Install editable', takesValue: true },
    ]},
    { name: 'uninstall', description: 'Uninstall packages', flags: [
      { name: '-y', alias: '--yes', description: 'Skip confirmation' },
    ]},
    { name: 'freeze', description: 'Output installed packages in requirements format' },
    { name: 'list', description: 'List installed packages', flags: [
      { name: '--outdated', description: 'Show outdated packages' },
    ]},
    { name: 'show', description: 'Show package information' },
    { name: 'search', description: 'Search PyPI for packages' },
  ],
};

const pip3Spec: CommandSpec = { ...pipSpec, name: 'pip3', description: 'Python 3 package installer' };

// ── Cargo ────────────────────────────────────────────────────────────

const cargoSpec: CommandSpec = {
  name: 'cargo',
  description: 'Rust package manager',
  subcommands: [
    { name: 'build', description: 'Compile the current package', flags: [
      { name: '--release', description: 'Build in release mode' },
      { name: '--target', description: 'Build for target triple', takesValue: true },
      { name: '-p', alias: '--package', description: 'Build specific package', takesValue: true },
    ]},
    { name: 'run', description: 'Run the current package', flags: [
      { name: '--release', description: 'Run in release mode' },
      { name: '--bin', description: 'Run specific binary', takesValue: true },
      { name: '--example', description: 'Run an example', takesValue: true },
    ]},
    { name: 'test', description: 'Run tests', flags: [
      { name: '--release', description: 'Test in release mode' },
      { name: '--lib', description: 'Test only lib' },
      { name: '--doc', description: 'Test doc examples' },
    ]},
    { name: 'check', description: 'Check for errors without building' },
    { name: 'clippy', description: 'Run the Clippy linter' },
    { name: 'fmt', description: 'Format source code' },
    { name: 'new', description: 'Create a new package', flags: [
      { name: '--lib', description: 'Create a library' },
      { name: '--bin', description: 'Create a binary (default)' },
    ]},
    { name: 'init', description: 'Create a package in existing directory' },
    { name: 'add', description: 'Add a dependency', flags: [
      { name: '--dev', description: 'Add as dev dependency' },
      { name: '--features', description: 'Enable features', takesValue: true },
    ]},
    { name: 'remove', description: 'Remove a dependency' },
    { name: 'update', description: 'Update dependencies' },
    { name: 'publish', description: 'Publish to crates.io', flags: [
      { name: '--dry-run', description: 'Dry run' },
    ]},
    { name: 'doc', description: 'Build documentation', flags: [
      { name: '--open', description: 'Open in browser' },
    ]},
    { name: 'clean', description: 'Remove build artifacts' },
    { name: 'bench', description: 'Run benchmarks' },
    { name: 'tree', description: 'Display dependency tree' },
  ],
};

// ── Go ───────────────────────────────────────────────────────────────

const goSpec: CommandSpec = {
  name: 'go',
  description: 'Go programming language toolchain',
  subcommands: [
    { name: 'build', description: 'Compile packages and dependencies', flags: [
      { name: '-o', description: 'Output file', takesValue: true },
      { name: '-v', description: 'Verbose output' },
      { name: '-race', description: 'Enable race detector' },
    ]},
    { name: 'run', description: 'Compile and run a program' },
    { name: 'test', description: 'Run tests', flags: [
      { name: '-v', description: 'Verbose output' },
      { name: '-run', description: 'Run specific test', takesValue: true },
      { name: '-cover', description: 'Enable coverage' },
      { name: '-race', description: 'Enable race detector' },
      { name: '-bench', description: 'Run benchmarks', takesValue: true },
      { name: '-count', description: 'Run N times', takesValue: true },
    ]},
    { name: 'get', description: 'Download and install packages' },
    { name: 'mod', description: 'Module maintenance', subcommands: [
      { name: 'init', description: 'Initialize module' },
      { name: 'tidy', description: 'Add/remove module requirements' },
      { name: 'download', description: 'Download modules' },
      { name: 'vendor', description: 'Make vendored copy' },
      { name: 'verify', description: 'Verify dependencies' },
      { name: 'graph', description: 'Print module requirement graph' },
    ]},
    { name: 'fmt', description: 'Format Go source files' },
    { name: 'vet', description: 'Report suspicious constructs' },
    { name: 'generate', description: 'Generate Go files by running commands' },
    { name: 'install', description: 'Compile and install packages' },
    { name: 'clean', description: 'Remove object files and cached files' },
    { name: 'env', description: 'Print Go environment information' },
    { name: 'doc', description: 'Show documentation' },
    { name: 'version', description: 'Print Go version' },
    { name: 'work', description: 'Workspace maintenance', subcommands: [
      { name: 'init', description: 'Initialize workspace' },
      { name: 'use', description: 'Add modules to workspace' },
      { name: 'sync', description: 'Sync workspace build list' },
    ]},
  ],
};

// ── Make ─────────────────────────────────────────────────────────────

const makeSpec: CommandSpec = {
  name: 'make',
  description: 'Build automation tool',
  flags: [
    { name: '-j', description: 'Parallel jobs', takesValue: true },
    { name: '-f', description: 'Specify makefile', takesValue: true },
    { name: '-n', alias: '--dry-run', description: 'Dry run' },
    { name: '-B', alias: '--always-make', description: 'Unconditionally make all targets' },
    { name: '-C', description: 'Change directory first', takesValue: true },
    { name: '-k', alias: '--keep-going', description: 'Keep going on errors' },
    { name: '-s', alias: '--silent', description: 'Silent mode' },
  ],
};

// ── SSH / SCP ────────────────────────────────────────────────────────

const sshSpec: CommandSpec = {
  name: 'ssh',
  description: 'Secure Shell client',
  flags: [
    { name: '-p', description: 'Port', takesValue: true },
    { name: '-i', description: 'Identity file (private key)', takesValue: true },
    { name: '-L', description: 'Local port forward', takesValue: true },
    { name: '-R', description: 'Remote port forward', takesValue: true },
    { name: '-D', description: 'Dynamic (SOCKS) port forward', takesValue: true },
    { name: '-N', description: 'No remote command' },
    { name: '-f', description: 'Go to background' },
    { name: '-v', description: 'Verbose mode' },
    { name: '-A', description: 'Enable agent forwarding' },
    { name: '-X', description: 'Enable X11 forwarding' },
    { name: '-o', description: 'SSH option', takesValue: true },
    { name: '-J', description: 'Jump host', takesValue: true },
  ],
};

const scpSpec: CommandSpec = {
  name: 'scp',
  description: 'Secure copy',
  flags: [
    { name: '-r', description: 'Recursively copy directories' },
    { name: '-P', description: 'Port', takesValue: true },
    { name: '-i', description: 'Identity file', takesValue: true },
    { name: '-C', description: 'Enable compression' },
    { name: '-v', description: 'Verbose mode' },
  ],
};

// ── grep ─────────────────────────────────────────────────────────────

const grepSpec: CommandSpec = {
  name: 'grep',
  description: 'Search text using patterns',
  flags: [
    { name: '-r', alias: '-R', description: 'Search recursively' },
    { name: '-i', description: 'Case insensitive' },
    { name: '-n', description: 'Show line numbers' },
    { name: '-l', description: 'Only print filenames' },
    { name: '-c', description: 'Count matches' },
    { name: '-v', description: 'Invert match' },
    { name: '-w', description: 'Match whole words' },
    { name: '-E', description: 'Extended regex' },
    { name: '-P', description: 'Perl-compatible regex' },
    { name: '--include', description: 'Search only matching files', takesValue: true },
    { name: '--exclude', description: 'Skip matching files', takesValue: true },
    { name: '--exclude-dir', description: 'Skip matching directories', takesValue: true },
    { name: '-A', description: 'Lines after match', takesValue: true },
    { name: '-B', description: 'Lines before match', takesValue: true },
    { name: '-C', description: 'Lines of context', takesValue: true },
    { name: '--color', description: 'Highlight matches' },
  ],
};

// ── find ─────────────────────────────────────────────────────────────

const findSpec: CommandSpec = {
  name: 'find',
  description: 'Search for files in a directory hierarchy',
  flags: [
    { name: '-name', description: 'Match filename pattern', takesValue: true },
    { name: '-iname', description: 'Case-insensitive name match', takesValue: true },
    { name: '-type', description: 'File type (f/d/l)', takesValue: true },
    { name: '-size', description: 'File size', takesValue: true },
    { name: '-mtime', description: 'Modified time (days)', takesValue: true },
    { name: '-exec', description: 'Execute command on results' },
    { name: '-delete', description: 'Delete matching files' },
    { name: '-maxdepth', description: 'Maximum directory depth', takesValue: true },
    { name: '-mindepth', description: 'Minimum directory depth', takesValue: true },
    { name: '-path', description: 'Match path pattern', takesValue: true },
    { name: '-not', description: 'Negate the next expression' },
    { name: '-prune', description: 'Do not descend into directory' },
    { name: '-print', description: 'Print path (default)' },
    { name: '-print0', description: 'Print path null-delimited' },
  ],
};

// ── curl ─────────────────────────────────────────────────────────────

const curlSpec: CommandSpec = {
  name: 'curl',
  description: 'Transfer data from or to a server',
  flags: [
    { name: '-X', alias: '--request', description: 'HTTP method', takesValue: true },
    { name: '-H', alias: '--header', description: 'Request header', takesValue: true },
    { name: '-d', alias: '--data', description: 'Request body', takesValue: true },
    { name: '-o', alias: '--output', description: 'Write output to file', takesValue: true },
    { name: '-O', alias: '--remote-name', description: 'Save with remote filename' },
    { name: '-L', alias: '--location', description: 'Follow redirects' },
    { name: '-s', alias: '--silent', description: 'Silent mode' },
    { name: '-v', alias: '--verbose', description: 'Verbose mode' },
    { name: '-k', alias: '--insecure', description: 'Skip TLS verification' },
    { name: '-I', alias: '--head', description: 'HEAD request only' },
    { name: '-u', alias: '--user', description: 'User:password', takesValue: true },
    { name: '--connect-timeout', description: 'Connection timeout', takesValue: true },
    { name: '--max-time', description: 'Max transfer time', takesValue: true },
    { name: '-F', alias: '--form', description: 'Multipart form data', takesValue: true },
  ],
};

// ── Common Unix commands ─────────────────────────────────────────────

const lsSpec: CommandSpec = {
  name: 'ls',
  description: 'List directory contents',
  flags: [
    { name: '-l', description: 'Long listing format' },
    { name: '-a', description: 'Show hidden files' },
    { name: '-h', description: 'Human-readable sizes' },
    { name: '-R', description: 'List recursively' },
    { name: '-t', description: 'Sort by modification time' },
    { name: '-S', description: 'Sort by file size' },
    { name: '-r', description: 'Reverse sort order' },
    { name: '-1', description: 'One entry per line' },
  ],
};

const catSpec: CommandSpec = {
  name: 'cat',
  description: 'Concatenate and display files',
  flags: [
    { name: '-n', description: 'Number all output lines' },
    { name: '-b', description: 'Number non-blank lines' },
    { name: '-s', description: 'Squeeze blank lines' },
  ],
};

const chmodSpec: CommandSpec = {
  name: 'chmod',
  description: 'Change file permissions',
  flags: [
    { name: '-R', description: 'Change files and directories recursively' },
    { name: '-v', description: 'Verbose output' },
  ],
};

const chownSpec: CommandSpec = {
  name: 'chown',
  description: 'Change file owner and group',
  flags: [
    { name: '-R', description: 'Operate on files and directories recursively' },
    { name: '-v', description: 'Verbose output' },
  ],
};

const tarSpec: CommandSpec = {
  name: 'tar',
  description: 'Tape archiver',
  flags: [
    { name: '-c', description: 'Create archive' },
    { name: '-x', description: 'Extract archive' },
    { name: '-z', description: 'Filter through gzip' },
    { name: '-j', description: 'Filter through bzip2' },
    { name: '-f', description: 'Archive file name', takesValue: true },
    { name: '-v', description: 'Verbose' },
    { name: '-t', description: 'List archive contents' },
    { name: '-C', description: 'Change directory', takesValue: true },
    { name: '--exclude', description: 'Exclude pattern', takesValue: true },
  ],
};

const rsyncSpec: CommandSpec = {
  name: 'rsync',
  description: 'Fast, versatile file copying tool',
  flags: [
    { name: '-a', alias: '--archive', description: 'Archive mode' },
    { name: '-v', alias: '--verbose', description: 'Verbose' },
    { name: '-z', alias: '--compress', description: 'Compress during transfer' },
    { name: '--progress', description: 'Show progress' },
    { name: '--delete', description: 'Delete extra files in destination' },
    { name: '-n', alias: '--dry-run', description: 'Dry run' },
    { name: '-e', description: 'Remote shell command', takesValue: true },
    { name: '--exclude', description: 'Exclude pattern', takesValue: true },
  ],
};

// ── yarn ─────────────────────────────────────────────────────────────

const yarnSpec: CommandSpec = {
  name: 'yarn',
  description: 'JavaScript package manager',
  subcommands: [
    { name: 'add', description: 'Add a dependency', flags: [
      { name: '-D', alias: '--dev', description: 'Add as dev dependency' },
      { name: '-E', alias: '--exact', description: 'Exact version' },
      { name: '--global', description: 'Install globally' },
    ]},
    { name: 'remove', description: 'Remove a dependency' },
    { name: 'install', description: 'Install all dependencies' },
    { name: 'start', description: 'Run start script' },
    { name: 'build', description: 'Run build script' },
    { name: 'test', description: 'Run test script' },
    { name: 'run', description: 'Run a script' },
    { name: 'upgrade', description: 'Upgrade packages' },
    { name: 'init', description: 'Create a package.json' },
    { name: 'link', description: 'Symlink a package' },
    { name: 'unlink', description: 'Unlink a symlinked package' },
    { name: 'cache', description: 'Manage the package cache', subcommands: [
      { name: 'clean', description: 'Clean the cache' },
      { name: 'dir', description: 'Print cache directory' },
    ]},
    { name: 'why', description: 'Show why a package is installed' },
    { name: 'workspaces', description: 'Manage workspaces' },
  ],
};

// ── pnpm ─────────────────────────────────────────────────────────────

const pnpmSpec: CommandSpec = {
  name: 'pnpm',
  description: 'Fast, disk space efficient package manager',
  subcommands: [
    { name: 'add', description: 'Install a package', flags: [
      { name: '-D', alias: '--save-dev', description: 'Add as dev dependency' },
      { name: '-g', alias: '--global', description: 'Install globally' },
      { name: '-E', alias: '--save-exact', description: 'Exact version' },
    ]},
    { name: 'install', description: 'Install all dependencies' },
    { name: 'remove', description: 'Remove a package' },
    { name: 'update', description: 'Update packages' },
    { name: 'run', description: 'Run a script' },
    { name: 'exec', description: 'Execute a shell command' },
    { name: 'dlx', description: 'Run a package in a temp env' },
    { name: 'create', description: 'Create a project from a create-* starter' },
    { name: 'store', description: 'Manage the global store', subcommands: [
      { name: 'prune', description: 'Remove unreferenced packages' },
      { name: 'path', description: 'Print store path' },
      { name: 'status', description: 'Check for modified packages' },
    ]},
  ],
};

// ── python ────────────────────────────────────────────────────────────

const pythonSpec: CommandSpec = {
  name: 'python',
  description: 'Python interpreter',
  flags: [
    { name: '-m', description: 'Run module as script', takesValue: true },
    { name: '-c', description: 'Execute command string', takesValue: true },
    { name: '-V', alias: '--version', description: 'Print version' },
    { name: '-u', description: 'Unbuffered stdout/stderr' },
    { name: '-i', description: 'Interactive mode after running script' },
    { name: '-B', description: 'Do not write .pyc files' },
  ],
};

const python3Spec: CommandSpec = { ...pythonSpec, name: 'python3', description: 'Python 3 interpreter' };

// ── terraform ────────────────────────────────────────────────────────

const terraformSpec: CommandSpec = {
  name: 'terraform',
  description: 'Infrastructure as Code tool',
  subcommands: [
    { name: 'init', description: 'Initialize a Terraform working directory' },
    { name: 'plan', description: 'Show execution plan', flags: [
      { name: '-out', description: 'Save plan to file', takesValue: true },
      { name: '-var', description: 'Set a variable', takesValue: true },
      { name: '-var-file', description: 'Variable definitions file', takesValue: true },
    ]},
    { name: 'apply', description: 'Apply changes', flags: [
      { name: '-auto-approve', description: 'Skip approval' },
      { name: '-var', description: 'Set a variable', takesValue: true },
    ]},
    { name: 'destroy', description: 'Destroy infrastructure', flags: [
      { name: '-auto-approve', description: 'Skip approval' },
    ]},
    { name: 'validate', description: 'Validate configuration' },
    { name: 'fmt', description: 'Format configuration' },
    { name: 'output', description: 'Show output values' },
    { name: 'state', description: 'State management', subcommands: [
      { name: 'list', description: 'List resources in state' },
      { name: 'show', description: 'Show a resource in state' },
      { name: 'mv', description: 'Move a resource' },
      { name: 'rm', description: 'Remove a resource from state' },
      { name: 'pull', description: 'Pull current state' },
      { name: 'push', description: 'Push local state to remote' },
    ]},
    { name: 'workspace', description: 'Manage workspaces', subcommands: [
      { name: 'list', description: 'List workspaces' },
      { name: 'new', description: 'Create workspace' },
      { name: 'select', description: 'Switch workspace' },
      { name: 'delete', description: 'Delete workspace' },
    ]},
    { name: 'import', description: 'Import existing infrastructure' },
    { name: 'refresh', description: 'Refresh state' },
    { name: 'taint', description: 'Mark resource for recreation' },
    { name: 'untaint', description: 'Remove taint from resource' },
  ],
};

// ── Collected specs ──────────────────────────────────────────────────

export const ALL_SPECS: CommandSpec[] = [
  gitSpec,
  npmSpec,
  npxSpec,
  dockerSpec,
  kubectlSpec,
  awsSpec,
  brewSpec,
  pipSpec,
  pip3Spec,
  cargoSpec,
  goSpec,
  makeSpec,
  sshSpec,
  scpSpec,
  grepSpec,
  findSpec,
  curlSpec,
  lsSpec,
  catSpec,
  chmodSpec,
  chownSpec,
  tarSpec,
  rsyncSpec,
  yarnSpec,
  pnpmSpec,
  pythonSpec,
  python3Spec,
  terraformSpec,
];

/** Quick lookup by command name */
export const SPEC_MAP: Map<string, CommandSpec> = new Map(
  ALL_SPECS.map(s => [s.name, s])
);
