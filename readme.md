# Git Command Visualizer

A modern, interactive web app to visualize and learn Git commands step-by-step.

## Features

- **Visualize Git Repositories:** See your commit graph update live as you type git commands.
- **Interactive Terminal:** Type supported git commands and watch the graph respond.
- **Onboarding Tutorial:** First-time users can follow a guided, step-by-step tutorial to learn the basics of git (init, commit, branch, checkout, merge).
- **Preloaded Scenarios:** Explore common git workflows with one click.
- **Commit Details:** Click any node to see commit info, parents, branches, and tags.
- **Beautiful UI:** Uses the Poppins font and a modern, dark-themed interface.

## Getting Started

1. **Clone or Download** this repository.
2. **Open `index.html`** in your browser. No build step required.

## Usage

- Type git commands in the terminal panel (bottom right).
- Try commands like:
  - `git init`
  - `git commit -m "message"`
  - `git branch feature`
  - `git checkout feature`
  - `git merge feature`
- Click **Start Tutorial** (when no repo is initialized) for a guided onboarding.
- Use the **Scenarios** button (top right) to load example workflows.

## Supported Commands

- `git init`
- `git commit -m "..."`
- `git branch <name>`
- `git checkout <name>` / `git checkout -b <name>`
- `git merge <branch>`
- `git rebase <branch>`
- `git cherry-pick <sha>`
- `git reset --hard <target>`
- `git stash`, `git stash pop`
- `git log`, `git status`, `git tag <name>`
- `help`, `clear`

## Development

- All logic is in `script.js`.
- Styles in `style.css`.
- No dependencies, no build tools required.

## License

MIT License
