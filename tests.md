# Git Visualizer Test Scenarios

Below are 30 scenarios for manual QA testing. Each scenario is a sequence of git commands or a specific edge case to test.

---

1. git init → git commit -m "first" → git branch feature → git commit -m "second" → git merge feature
2. git init → git commit -m "first" → git checkout HEAD → git commit -m "detached"
3. git init → git commit -m "first" → git branch dev → git checkout dev → git commit -m "dev work" → git merge master
4. git init → git commit -m "first" → git branch bugfix → git commit -m "fix" → git merge bugfix
5. git init → git commit -m "first" → git branch feature → git checkout feature → git commit -m "feature" → git rebase master
6. git init → git commit -m "first" → git branch hotfix → git checkout hotfix → git commit -m "hotfix" → git cherry-pick master
7. git init → git commit -m "first" → git branch test → git branch -d test
8. git init → git commit -m "first" → git branch test → git branch -d master
9. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git reset --hard HEAD~1
10. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git tag v1
11. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git stash → git stash pop
12. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git log --graph
13. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git diff master test
14. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git push test
15. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git pull test
16. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git checkout master
17. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git checkout nonexist
18. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git branch -d test
19. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git branch -d master
20. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git merge master
21. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git merge test
22. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git rebase master
23. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git cherry-pick master
24. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git reset --hard HEAD~1
25. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git tag v1
26. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git stash → git stash pop
27. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git log --graph
28. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git diff master test
29. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git push test
30. git init → git commit -m "first" → git branch test → git checkout test → git commit -m "test" → git pull test

---

For each scenario, run the commands in sequence and verify:
- No errors unless expected
- Graph updates correctly
- Branches, tags, stashes, and HEAD behave as expected
- Edge cases (deleting current branch, merging into self, etc.) are handled
