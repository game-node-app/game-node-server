# Spec Delta

## Purpose

Turns daily puzzle results into a fair competition: which results earn points, how many, and how players are ranked, filtered, compared over time and summarized for the ranking page, the hub and the result screen.

## ADDED Requirements

### Requirement: Only same-day signed-in daily finishes count
A daily result SHALL count for the ranking only when a signed-in player finished it through the play endpoint on the puzzle's own date in São Paulo. Archive plays, guest plays, results created by the import endpoint, weekly challenge results and practice rounds SHALL NOT count. Whether a result counts SHALL be fixed when it finishes and never change afterwards.

#### Scenario: Finished on the puzzle day
- **WHEN** a signed-in player finishes today's Cover puzzle at 23:59 São Paulo time
- **THEN** the result counts for the ranking

#### Scenario: Finished after midnight
- **WHEN** a signed-in player started yesterday's puzzle and finishes it at 00:01 São Paulo time today
- **THEN** the result does not count and earns 0 points

#### Scenario: Archive play
- **WHEN** a signed-in player finishes a puzzle from a previous day
- **THEN** the result is saved as today but does not count for the ranking

#### Scenario: Imported guest result
- **WHEN** a guest finishes today's puzzle and imports it after signing in on the same day
- **THEN** the imported result is saved but never counts for the ranking

### Requirement: Points per counted result
A counted win in Cover, Artwork or Keywords SHALL earn 7 minus the attempts used (6 for the first attempt down to 1 for the sixth). A counted Specs win SHALL earn 0.6 times the lives left when the answer was found, from 6 on the first attempt down to 0.6 on the tenth. Skips and the Specs hint SHALL count as attempts. A loss SHALL earn 0. Points SHALL be exact to one decimal place.

#### Scenario: Cover third attempt
- **WHEN** a counted Cover result is won on the third attempt
- **THEN** it earns 4 points

#### Scenario: Skip counts as an attempt
- **WHEN** a counted Artwork result skips once and then guesses correctly
- **THEN** it earns 5 points

#### Scenario: Specs boundaries
- **WHEN** counted Specs results are won on the first and on the tenth attempt
- **THEN** they earn 6 and 0.6 points

#### Scenario: Specs hint
- **WHEN** a counted Specs result uses the hint after five guesses and wins on the next guess
- **THEN** it earns the points for seven attempts, 2.4

#### Scenario: Loss
- **WHEN** a counted result is lost
- **THEN** it earns 0 points but still counts as played for the win rate

### Requirement: Daily completion bonus
A player SHALL earn a 2-point bonus for each São Paulo day on which all four modes of that day have counted wins. The bonus SHALL belong to that day and SHALL be included in the overall ranking only, not in a single-mode ranking.

#### Scenario: All four modes won
- **WHEN** a player has counted wins in Cover, Artwork, Keywords and Specs for today
- **THEN** today's overall points include a 2-point bonus

#### Scenario: One mode lost
- **WHEN** a player won three modes and lost the fourth today
- **THEN** no bonus is added for today

#### Scenario: Mode ranking
- **WHEN** the ranking is filtered to Specs
- **THEN** no player's points include a bonus

### Requirement: Existing results receive points at launch
On deployment, existing results finished on their puzzle's date SHALL be marked as counted and receive points by the same rules, and other existing results SHALL not count. Existing puzzles, guesses, statuses and attempts SHALL NOT change.

#### Scenario: Historical same-day win
- **WHEN** a result won on the puzzle's date exists before deployment
- **THEN** after deployment it counts with the points the rules give it

#### Scenario: Historical archive play
- **WHEN** a result finished after its puzzle's date exists before deployment
- **THEN** after deployment it does not count

### Requirement: Ranking periods
The ranking SHALL support the periods `today`, `week` (Monday to Sunday), `month` (calendar month) and `all`, using São Paulo dates of the puzzles. A period SHALL include only puzzles dated within it and not after today. The response SHALL include the instant the period ends, or null for `all`.

#### Scenario: Week on a Wednesday
- **WHEN** the week ranking is read on a Wednesday
- **THEN** it includes counted results for Monday, Tuesday and Wednesday puzzles only
- **AND** it reports the end of the coming Sunday in São Paulo as the period end

#### Scenario: All time
- **WHEN** the `all` ranking is read
- **THEN** it includes every counted result and the period end is null

### Requirement: Mode filter
The ranking SHALL be overall (all four modes plus bonuses) when no mode is given, and limited to that mode's counted results when a mode is given. An unknown mode or period SHALL be rejected with a validation error.

#### Scenario: Cover filter
- **WHEN** the week ranking is filtered to Cover
- **THEN** points, solved count, average attempts and win rate use Cover results only

#### Scenario: Invalid filter
- **WHEN** the ranking is requested with an unknown mode or period
- **THEN** the request is rejected with a 400 error

### Requirement: Who appears in a ranking
A ranking SHALL list every player with at least one counted result in the period and filter, including players with 0 points. Banned and suspended players SHALL be left out and SHALL NOT take positions. Deleted accounts SHALL not appear.

#### Scenario: Player who only lost
- **WHEN** a player's only counted result this week is a loss
- **THEN** they appear in the week ranking with 0 points

#### Scenario: Banned player
- **WHEN** the player with the most points is banned
- **THEN** they are absent and the next player is first

### Requirement: Ordering and ties
Players SHALL be ordered by points descending, then by fewer total attempts across counted wins, then by the earlier time of their last counted finish, then by user id. Positions SHALL be consecutive starting at 1, with no shared positions.

#### Scenario: Equal points
- **WHEN** two players have the same points and one used fewer attempts
- **THEN** the one with fewer attempts is placed first

#### Scenario: Equal points and attempts
- **WHEN** two players tie on points and attempts
- **THEN** the one whose last counted finish was earlier is placed first

### Requirement: Following scope
The ranking SHALL support the scope `all` and the scope `following`, which contains only the viewer and the players the viewer follows, with positions renumbered within that set. The `following` scope SHALL require a session.

#### Scenario: Following scope
- **WHEN** a signed-in viewer follows three players who all scored this week
- **THEN** the following ranking lists at most those three and the viewer, positioned 1 to 4

#### Scenario: Following without session
- **WHEN** a guest requests the following scope
- **THEN** the request is rejected with a 401 error

### Requirement: Ranking rows
Each ranking row SHALL include the position, the position change, the player's user id, username, avatar, supporter badge flag, points and win rate. Overall rows SHALL also include points per mode and the current streak. Mode rows SHALL also include the number of wins, the average attempts of wins and the best streak in that mode.

#### Scenario: Overall row
- **WHEN** the overall week ranking is read
- **THEN** each row includes points for each of the four modes and the current streak

#### Scenario: Mode row
- **WHEN** the Keywords week ranking is read
- **THEN** each row includes wins, average attempts and best Keywords streak

#### Scenario: Win rate
- **WHEN** a player has four counted wins and one counted loss in the period and filter
- **THEN** the row's win rate is 80%

### Requirement: Position change since yesterday
For the `week`, `month` and `all` periods, each row SHALL report how many positions the player moved compared with the same ranking computed without today's puzzles, or that the player is new to it. For `today` the change SHALL be null.

#### Scenario: Player moved up
- **WHEN** a player was 7th without today's results and is 4th with them
- **THEN** the row reports a change of +3

#### Scenario: New player
- **WHEN** a player's first counted result in the week is today
- **THEN** the row reports the player as new

### Requirement: Streaks
A player's current streak SHALL be the number of consecutive São Paulo days, ending today or yesterday, with at least one counted win; it SHALL be 0 otherwise. A mode's best streak SHALL be the longest run of consecutive days with a counted win in that mode, over all time.

#### Scenario: Not played yet today
- **WHEN** a player won counted puzzles on each of the last five days but has not played today
- **THEN** the current streak is 5

#### Scenario: Missed a day
- **WHEN** a player's last counted win was two days ago
- **THEN** the current streak is 0

### Requirement: Viewer summary
For a signed-in viewer the ranking response SHALL include the viewer's own row (or null when they have no counted result in it) and, when the viewer is outside the top 100, the points needed to reach position 100. Guests SHALL receive the ranking without a viewer row.

#### Scenario: Viewer outside the top 100
- **WHEN** the viewer is 142nd with 1084 points and the 100th player has 1122
- **THEN** the response reports the viewer row at 142 and 38 points to the top 100

#### Scenario: Guest
- **WHEN** a guest reads the ranking
- **THEN** the response is the same list with no viewer row

### Requirement: Pagination and totals
The ranking SHALL be paginated with offset and limit (limit at most 100) and SHALL report the total number of ranked players for the period, filter and scope.

#### Scenario: Second page
- **WHEN** the ranking is read with offset 10 and limit 10
- **THEN** rows for positions 11 to 20 are returned with the total player count

### Requirement: Ranking freshness
A ranking read SHALL reflect counted results at most 60 seconds old. The viewer's own points in a play response SHALL always include the result just finished.

#### Scenario: Another player's new result
- **WHEN** another player finishes a counted puzzle
- **THEN** the ranking shows it within 60 seconds

### Requirement: Points summary after a play
When a signed-in player finishes a daily puzzle, the play response SHALL include the points earned, the bonus earned, whether the result counts, and the player's week points, week position before and after the result, and points to the top 100 of the week. Guest plays, unfinished plays and non-daily puzzles SHALL omit it.

#### Scenario: Counted finish
- **WHEN** a signed-in player wins today's Cover puzzle on the third attempt
- **THEN** the play response reports 4 points earned and the week position before and after

#### Scenario: Archive finish
- **WHEN** a signed-in player finishes an archive puzzle
- **THEN** the play response reports that the result does not count and 0 points

#### Scenario: Reopening a finished puzzle
- **WHEN** the player requests the play of a puzzle they already finished
- **THEN** the summary reports the points that result earned, without counting them again

### Requirement: Supporters gain no ranking advantage
Supporter status SHALL only be exposed as a badge flag on ranking rows, shown when the player is entitled and has not hidden the badge. It SHALL NOT change points, eligibility or ordering.

#### Scenario: Supporter with hidden badge
- **WHEN** an entitled supporter has turned off their badge
- **THEN** their ranking rows report no badge and their position is unchanged
