/* ==========================================================================
   UPDATES / BLOG POSTS — edit this file to add a post.

   Copy the template below, paste it at the TOP of the list, and fill it in.
   Posts are shown newest first (sorted by date), so order here doesn't matter.

   {
       title: 'Post title',
       date: '2026-11-09',                    // YYYY-MM-DD
       description: 'First paragraph.\n\nSecond paragraph.',   // \n\n = new paragraph
       image: 'images/my-picture.jpg',        // optional — put the file in updates/images/
       games: ['dash-parkour'],               // optional — game folder names from /games
       links: [                               // optional — any other links
           { label: 'Play on Khan Academy', url: 'https://www.khanacademy.org/...' }
       ]
   },

   Tips
   - Leave out `image`, `games` or `links` if a post doesn't need them.
   - `games` turns each folder name into a card with the game's cover, title
     and color that links to its game page.
   - Wrap text containing an apostrophe in double quotes: "We're back!"
   ========================================================================== */
window.DK_UPDATES = [
    {
        title: 'Welcome to the new DK website!',
        date: '2026-11-09',
        description: "We rebuilt digitsandkineto.com from the ground up! The homepage now has every one of our games in one place, and each game gets its own page with a banner, description and play button.\n\nWe also released DASH Parkour 1.1 with multiplayer, and we're hard at work on our first Unity game. We'll post progress here as it happens, so check back soon!",
        image: '../assets/img/studio-banner.jpg',
        games: ['dash-parkour'],
        links: [
            { label: 'Try DK Converter', url: '../dkconverter/' },
            { label: 'Read our story', url: '../about/' }
        ]
    }
];
