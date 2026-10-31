/* ==========================================================================
   SPECSOFT® — your own emoji for chats (chat-emoji.js)
   Put this file next to chats.js. chats.js loads it by itself.

   Every line is one emoji:   { name: 'shortcode', image: '...' },
     name   letters, numbers, _ + -  (max 32 characters)  ->  people type :name:
     image  a full https:// link  OR  just the Windows 11 file name:
            { name: 'loudly_crying_face', image: 'loudly-crying-face_1f62d.png' },
            (file names look like  <official-name>_<codepoints>.png  on em-content.zobj.net)
   Each category = a section in the emoji picker. Add as many lines / categories as you want.
   A line of plain emoji like  'People': ['👍','🔥']  is fine too (they show as the Windows 11 picture).
   Allowed image hosts: em-content.zobj.net and emoji.gg  (change isCustomEmojiUrl() in chats.js to add more)
   ========================================================================== */
window.SPEC_CHAT_EMOJI = {
    'Emoticons': [
         { name: 'grinning', image: 'https://cdn3.emoji.gg/emojis/6199-win11emoji-grinning.png' },
         { name: 'grinning_with_big_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/grinning-face-with-big-eyes_1f603.png' },
         { name: 'grinning_with_smiling_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/grinning-face-with-smiling-eyes_1f604.png' },
         { name: 'beaming_with_smiling_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/beaming-face-with-smiling-eyes_1f601.png' },
         { name: 'grinning_squinting_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/grinning-squinting-face_1f606.png' },
         { name: 'grinning_face_with_sweat', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/grinning-face-with-sweat_1f605.png' },
         { name: 'rolling_on_the_floor_laughing', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/rolling-on-the-floor-laughing_1f923.png' },
         { name: 'face_with_tears_of_joy', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-tears-of-joy_1f602.png' },
         { name: 'slightly_smiling_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/slightly-smiling-face_1f642.png' },
         { name: 'upside_down_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/upside-down-face_1f643.png' },
         { name: 'melting_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/melting-face_1fae0.png' },
         { name: 'winking_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/winking-face_1f609.png' },
         { name: 'smiling_face_with_smiling_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smiling-face-with-smiling-eyes_1f60a.png' },
         { name: 'smiling_face_with_halo', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smiling-face-with-halo_1f607.png' },
         { name: 'smiling_face_with_hearts', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smiling-face-with-hearts_1f970.png' },
         { name: 'smiling_face_with_heart-eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smiling-face-with-heart-eyes_1f60d.png' },
         { name: 'star-struck', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/star-struck_1f929.png' },
         { name: 'face_blowing_a_kiss', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-blowing-a-kiss_1f618.png' },
         { name: 'kissing_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/kissing-face_1f617.png' },
         { name: 'smiling_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smiling-face_263a-fe0f.png' },
         { name: 'kissing_face_with_closed_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/kissing-face-with-closed-eyes_1f61a.png' },
         { name: 'kissing_face_with_smiling_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/kissing-face-with-smiling-eyes_1f619.png' },
         { name: 'smiling_face_with_tear', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smiling-face-with-tear_1f972.png' },
         { name: 'face_savoring_food', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-savoring-food_1f60b.png' },
         { name: 'face_with_tongue', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-tongue_1f61b.png' },
         { name: 'winking_face_with_tongue', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/winking-face-with-tongue_1f61c.png' },
         { name: 'zany_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/zany-face_1f92a.png' },
         { name: 'squinting_face_with_tongue', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/squinting-face-with-tongue_1f61d.png' },
         { name: 'money-mouth_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/money-mouth-face_1f911.png' },
         { name: 'hugging_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/hugging-face_1f917.png' },
         { name: 'face_with_hand_over_mouth', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-hand-over-mouth_1f92d.png' },
         { name: 'face_open_eyes_hand_over_mouth', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-open-eyes-and-hand-over-mouth_1fae2.png' },
         { name: 'face_with_peeking_eye', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-peeking-eye_1fae3.png' },
         { name: 'shushing_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/shushing-face_1f92b.png' },
         { name: 'thinking_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/thinking-face_1f914.png' },
         { name: 'saluting_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/saluting-face_1fae1.png' },
         { name: 'zipper-mouth_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/zipper-mouth-face_1f910.png' },
         { name: 'face_with_raised_eyebrow', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-raised-eyebrow_1f928.png' },
         { name: 'neutral_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/neutral-face_1f610.png' },
         { name: 'expressionless_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/expressionless-face_1f611.png' },
         { name: 'face_without_mouth', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-without-mouth_1f636.png' },
         { name: 'dotted_line_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/dotted-line-face_1fae5.png' },
         { name: 'face_in_clouds', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-in-clouds_1f636-200d-1f32b-fe0f.png' },
         { name: 'smirking_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smirking-face_1f60f.png' },
         { name: 'unamused_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/unamused-face_1f612.png' },
         { name: 'rolling_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-rolling-eyes_1f644.png' },
         { name: 'grimacing_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/grimacing-face_1f62c.png' },
         { name: 'lying_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/lying-face_1f925.png' },
         { name: 'shaking_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/shaking-face_1fae8.png' },
         { name: 'head_shaking_horizontally', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/head-shaking-horizontally_1f642-200d-2194-fe0f.png '},
         { name: 'head_shaking_vertically', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/head-shaking-horizontally_1f642-200d-2194-fe0f.png '},
         { name: 'relieved_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/relieved-face_1f60c.png' },
         { name: 'pensive_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/pensive-face_1f614.png' },
         { name: 'sleepy_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/sleepy-face_1f62a.png' },
         { name: 'drooling_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/drooling-face_1f924.png' },
         { name: 'sleeping_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/sleeping-face_1f634.png' },
         { name: 'face_bags_under_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-bags-under-eyes_1fae9.png '},
         { name: 'face_with_medical_mask', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-medical-mask_1f637.png' },
         { name: 'face_with_thermometer', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-thermometer_1f912.png' },
         { name: 'face_with_head-bandage', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-head-bandage_1f915.png' },
         { name: 'nauseated_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/nauseated-face_1f922.png' },
         { name: 'face_vommiting', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-vomiting_1f92e.png' },
         { name: 'sneezing_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/sneezing-face_1f927.png' },
         { name: 'hot_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/hot-face_1f975.png' },
         { name: 'cold_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/cold-face_1f976.png' },
         { name: 'woozy_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/woozy-face_1f974.png' },
         { name: 'dizzy_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/dizzy-face_1f635.png' },
         { name: 'face_with_spiral_eyes', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-spiral-eyes_1f635-200d-1f4ab.png' },
         { name: 'exploding_head', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/exploding-head_1f92f.png' },
         { name: 'cowboy_hat_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/cowboy-hat-face_1f920.png' },
         { name: 'partying_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/partying-face_1f973.png' },
         { name: 'disguised_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/disguised-face_1f978.png' },
         { name: 'face_with_sunglasses', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/smiling-face-with-sunglasses_1f60e.png' },
         { name: 'nerd_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/nerd-face_1f913.png' },
         { name: 'face_with_monocole', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-monocle_1f9d0.png' },
         { name: 'confused_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/confused-face_1f615.png' },
         { name: 'face_with_diagonal_mouth', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-diagonal-mouth_1fae4.png' },
         { name: 'worried_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/worried-face_1f61f.png' },
         { name: 'slightly_frowning_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/slightly-frowning-face_1f641.png' },
         { name: 'frowning_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/frowning-face_2639-fe0f.png' },
         { name: 'face_with_open_mouth', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-with-open-mouth_1f62e.png' },
         { name: 'hushed_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/hushed-face_1f62f.png' },
         { name: 'astonished_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/astonished-face_1f632.png' },
         { name: 'flushed_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/flushed-face_1f633.png' },
         { name: 'distorted_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/distorted-face_1faea.png' },
         { name: 'pleading_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/pleading-face_1f97a.png' },
         { name: 'face_holding_back_tears', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-holding-back-tears_1f979.png' },
         { name: 'frowning_with_open_mouth', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/frowning-face-with-open-mouth_1f626.png' },
         { name: 'anguished_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/anguished-face_1f627.png' },
         { name: 'fearful_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/fearful-face_1f628.png' },
         { name: 'anxious_face-with_sweat', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/anxious-face-with-sweat_1f630.png' },
         { name: 'sad_but_relieved_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/sad-but-relieved-face_1f625.png' },
         { name: 'crying_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/crying-face_1f622.png' },
         { name: 'loudly_crying_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/loudly-crying-face_1f62d.png' },
         { name: 'screaming_in_fear', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/face-screaming-in-fear_1f631.png' },
         { name: 'confounded_face', image: 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/confounded-face_1f616.png' },
    ],
    'People': ['👍','👎','👏','🙌','🙏','💪','👀','🤝','✌️','🤞','👋','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','🔥','✨','⭐','💯','🎉','🎊'],
    'Things': ['🎮','🕹️','💻','⌨️','🖥️','🧠','🛠️','⚙️','🚀','🛰️','🔒','🔑','📦','📁','📌','🧩','🎨','🎧','🎵','📸','💡','🔔','☕','🍕','🍔','🏆','🥇'],
    'Symbols': ['✅','❌','⚠️','❓','❗','➕','➖','➡️','⬆️','⬇️','🔴','🟢','🟡','🔵','⚪','⚫','🟣','💬','💭','🔗','📣'],
    'Meme Emojis': [
     { name: 'osaka', image: 'https://cdn3.emoji.gg/emojis/896127-osaka.gif' },
     { name: 'speedpray', image: 'https://cdn3.emoji.gg/emojis/583890-speedpray.gif' },
     { name: 'trollface', image: 'https://cdn3.emoji.gg/emojis/890856-troll.png' },
     { name: 'sonnn', image: 'https://cdn3.emoji.gg/emojis/896534-sonnnnnn.png' },
     { name: 'ohmygodbruh', image: 'https://cdn3.emoji.gg/emojis/56486-ohmygodbruh.gif' },
     { name: 'sus', image: 'https://cdn3.emoji.gg/emojis/761721-sus.png' },
     { name: 'monkeythink', image: 'https://cdn3.emoji.gg/emojis/801254-monkeythinking.png' },
     { name: 'soncrine', image: 'https://cdn3.emoji.gg/emojis/888036-soncrine.png' },
     { name: 'terified', image: 'https://cdn3.emoji.gg/emojis/126907-terrified.png' },
     { name: 'absolutecinema', image: 'https://cdn3.emoji.gg/emojis/74929-absolutecinema.png' }
    ]

    // ,'My Category': [
    //     { name: 'example', image: 'example-file-name_1f600.png' }
    // ]
};

// QUICK REACTIONS: the little bar that pops up when you react to a message (keep it to about 7-8).
// Each one can be:  '😭'  |  ':sob:' (any shortcode)  |  { name: 'my_emoji', image: 'file-name_1f525.png' or 'https://...' }
// If you use { name, image }, people can also type :my_emoji: and it shows up in search, like the rest.
window.SPEC_CHAT_QUICK = [
    '👍', '❤️', '😂', '🔥', '😭', '🎉', '💀'
    // , { name: 'my_emoji', image: 'loudly-crying-face_1f62d.png' }
];
