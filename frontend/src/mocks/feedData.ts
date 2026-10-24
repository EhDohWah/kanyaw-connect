import type { FeedComment, FeedPost } from '@/types/feed'
import type { PublicUser } from '@/types/user'

/**
 * Sample content for the preview feed. People are invented (Karen names) and images come from picsum.photos by seed, so
 * no real person appears. Nothing here is shown as real: the feed says it is a preview.
 */

const person = (key: string, name: string): PublicUser => ({ id: `mock-user-${key}`, name, avatar_url: null, avatar_thumb_url: null })

export const MOCK_PEOPLE: PublicUser[] = [
  person('htoo', 'Saw Htoo'),
  person('paw', 'Naw Paw'),
  person('kler', 'Saw Kler'),
  person('mu', 'Naw Mu'),
]

const [HTOO, PAW, KLER, MU] = MOCK_PEOPLE as [PublicUser, PublicUser, PublicUser, PublicUser]

interface Seed {
  author: PublicUser
  caption: string
  /** Picture seed for picsum.photos; none for a post that is only text (a notice). */
  picture?: string
  likes: number
  comments?: Array<[PublicUser, string]>
}

const SEEDS: Seed[] = [
  { author: PAW, caption: 'Market day was busy this morning. Fresh mangoes, banana leaves and the best sticky rice.', picture: 'market', likes: 18, comments: [[MU, 'Save me some mangoes next week!'], [KLER, 'The rice stall by the gate is the best.']] },
  { author: HTOO, caption: 'Community meeting this Saturday at 4 pm in the hall. We will talk about the new roof and the youth programme. Please come and bring your ideas.', likes: 31, comments: [[PAW, 'I will be there.']] },
  { author: MU, caption: 'The school plant sale raised enough for new books. Thank you to everyone who came and to the children who grew the seedlings.', picture: 'school-sale', likes: 44, comments: [[HTOO, 'Well done to all the children!'], [PAW, 'My daughter is so proud.'], [KLER, 'More books for the library!']] },
  { author: KLER, caption: 'Our garden after the first rains. The beans are climbing faster than we can build the poles.', picture: 'garden-beans', likes: 12 },
  { author: PAW, caption: 'Weaving class tonight. Grandmother Naw Eh is teaching the new pattern, everyone is welcome.', picture: 'weaving', likes: 27, comments: [[MU, 'What time does it start?'], [PAW, 'Seven, after dinner.']] },
  { author: HTOO, caption: 'Football practice moved to Sunday morning because of the rain. Same field, 8 am.', picture: 'football-field', likes: 9 },
  { author: MU, caption: 'Notice: the clinic visit is on Thursday. Bring your health card and arrive early. Mothers with small children go first.', likes: 22 },
  { author: KLER, caption: 'Cleaning the river bank with the youth group. Many hands, quick work.', picture: 'river-cleanup', likes: 36, comments: [[HTOO, 'Proud of this group.']] },
  { author: PAW, caption: 'Rice harvest has started in the lower fields. Long days, but the grain looks good this year.', picture: 'rice-harvest', likes: 40 },
  { author: HTOO, caption: 'Choir practice for the festival begins next week. New voices are welcome, no experience needed.', picture: 'choir', likes: 15 },
  { author: MU, caption: 'Kitchen team cooking for fifty tonight. The smell alone is worth the trip.', picture: 'big-pot', likes: 29, comments: [[PAW, 'Save a bowl for me.'], [KLER, 'Coming right now!']] },
  { author: KLER, caption: 'The new water tank is finished. Thank you to everyone who gave time and money.', picture: 'water-tank', likes: 52 },
  { author: PAW, caption: 'Language lesson for the little ones. They learned the names of twelve animals today.', picture: 'language-class', likes: 33, comments: [[MU, 'Which one was their favourite?'], [PAW, 'The elephant, of course.']] },
  { author: HTOO, caption: 'Reminder: please return the folding chairs to the hall after the event.', likes: 7 },
  { author: MU, caption: 'Morning mist over the hills. A quiet start before a long day.', picture: 'morning-mist', likes: 61 },
  { author: KLER, caption: 'We repaired the footbridge today. It is safe to cross again.', picture: 'footbridge', likes: 25 },
  { author: PAW, caption: 'Baking bread for the festival fundraiser. Orders open until Friday, ask me for the list.', picture: 'bread', likes: 19, comments: [[HTOO, 'Two loaves for me please.']] },
  { author: HTOO, caption: 'Thank you to everyone who came to the youth evening. The songs were beautiful.', picture: 'youth-evening', likes: 38 },
  { author: MU, caption: 'Sewing circle meets Wednesday afternoon. Bring fabric you no longer need, we will make bags.', picture: 'sewing', likes: 14 },
  { author: KLER, caption: 'Planting banana trees along the school fence so the children have shade.', picture: 'banana-trees', likes: 21 },
  { author: PAW, caption: 'Grandfather told the old river story at the fire tonight. The children did not move once.', picture: 'storytelling', likes: 57, comments: [[MU, 'I wish I had been there.'], [KLER, 'We should record these.']] },
  { author: HTOO, caption: 'The hall will be closed on Monday for painting. Meetings move to the school yard.', likes: 11 },
  { author: MU, caption: 'First tomatoes of the season. Sweet and still warm from the sun.', picture: 'tomatoes', likes: 26 },
  { author: KLER, caption: 'Boat race on the weekend! Teams from three villages are coming.', picture: 'boat-race', likes: 48, comments: [[PAW, 'Which team are you on?'], [KLER, 'The red boat, naturally.']] },
  { author: PAW, caption: 'Grandmother turned seventy-five today. Three generations around one table, and far too much food.', picture: 'birthday', likes: 73, comments: [[MU, 'Happy birthday to her!'], [HTOO, 'Many more years.']] },
  { author: HTOO, caption: 'Seed exchange next Sunday. Bring what you can spare, take what you need.', picture: 'seeds', likes: 17 },
  { author: MU, caption: 'The little library now has a reading corner with cushions. Come and see.', picture: 'reading-corner', likes: 34 },
  { author: KLER, caption: 'Drying chillies on the roof. The whole street smells of them.', picture: 'chillies', likes: 23 },
  { author: PAW, caption: 'Festival costumes are ready. Fitting on Friday evening at the hall.', picture: 'costumes', likes: 42 },
  { author: HTOO, caption: 'Welcome to the new families who joined us this month. Our door is open.', likes: 66 },
]

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

/** How many hours separate one sample post from the next. The newest was written a few minutes ago. */
const SPACING_HOURS = 5.5

export interface MockContent {
  /** Newest first. */
  posts: FeedPost[]
  /** What is already said under each post (oldest first). */
  comments: Record<string, FeedComment[]>
  /** How many likes each sample post already has, before yours. */
  baseLikes: Record<string, number>
}

/** The sample posts, dated relative to `now` so the feed always looks recent. The same inputs give the same posts. */
export function buildMockContent(now: number): MockContent {
  const posts: FeedPost[] = []
  const comments: Record<string, FeedComment[]> = {}
  const baseLikes: Record<string, number> = {}

  SEEDS.forEach((seed, index) => {
    const id = `mock-post-${String(index + 1).padStart(2, '0')}`
    const createdAt = now - 25 * MINUTE - index * SPACING_HOURS * HOUR
    const told = seed.comments ?? []
    const thread = told.map(([author, content], order): FeedComment => ({
      id: `mock-comment-${String(index + 1).padStart(2, '0')}-${order + 1}`,
      post_id: id,
      author,
      content,
      // Seventeen minutes apart after the post, but never later than a minute ago: a comment cannot be from the future.
      created_at: new Date(Math.min(createdAt + (order + 1) * 17 * MINUTE, now - (told.length - order) * MINUTE)).toISOString(),
    }))

    posts.push({
      id,
      author: seed.author,
      caption: seed.caption,
      image_url: seed.picture ? `https://picsum.photos/seed/kc-${seed.picture}/800/800` : null,
      created_at: new Date(createdAt).toISOString(),
      like_count: seed.likes,
      liked_by_me: false,
      comment_count: thread.length,
    })
    comments[id] = thread
    baseLikes[id] = seed.likes
  })

  return { posts, comments, baseLikes }
}
