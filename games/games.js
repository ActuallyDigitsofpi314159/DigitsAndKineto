/* ==========================================================================
   GAME LIST — edit this file to change the homepage.

   featured : folder name of the game shown in the big "featured" spot.
   order    : every game, in the order it appears on the homepage.
              - A string is a folder inside /games (it must contain game.js).
              - An object with `placeholder: true` shows a "coming soon" card.
                Replace it with the folder name once that game has a folder.

   ADDING A GAME
   1. Copy games/dash-parkour/ to games/<new-folder-name>/
   2. Edit the new game.js (title, descriptions, color, play link)
   3. Replace cover.jpg, banner.jpg and logo.png
   4. Add "<new-folder-name>" to `order` below
   ========================================================================== */
window.DK_GAMES = {
    featured: 'dash-parkour',
    order: [
        'dash-parkour',
        'path-of-light',
        'generic',
        'wumpus',
        { placeholder: true, title: 'Donkey Khan' }
    ]
};
