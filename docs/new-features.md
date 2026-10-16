
1.
Implement some Jev features:
a) 'radar' - first need to implement scrapers for indeed/seek/linkedin jobs. Then need to pass through JEV AI, etc. Check this chat for specifics: https://chatgpt.com/c/6ac5e068-1bf8-83ec-a27d-817c7b82823d
b) blah in the doc^


2.
I'd like to implement a 'modes' feature. For now make a detailed plan for this feature.
Currently the functionality is catered towards a software engineer finding a job.
The second 'mode' I want to design for my dad - who's trying to land a role in the Australian Public Service as an APS5/6. Further context below. I want it to be tailored.

'modes' should hide/unhide sections. So there might be no need for the 'learn' page tab which has leetcode stuff on the australian government mode.
Aside from hiding/unhiding relevant sections, perhaps a replacement of the current sections content with more contextually relevant components.
A user can 'switch' between modes and their information from the other mode should just be hidden till they enable it again.


My dad is 55 years old, a social services worker, and the primary provider of my the family. He currently works in aged care but is getting tired of the physical work. The tough odd weekend hours are not great at his age.

My mum works basic jobs - currently doing pick and packing (although that is physically demanding and she wants to stop and potentially find something else soon). H
My brother is in year 11 and will finish year 12 next year. He will go to university somewhere in Australia and live alone - funded by my parents (accomodation/food/general expenses)..
All 3 of them currently live in Sydney. when my brother finishes year 12, the plan is for both of my parents to move back to Canberra and live in the 1 bedroom part of the house they own (they will rent out the 4 bedroom above place to somebody else).

My dad is trying to find a good job in Canberra to settle into as he approaches retirement.
He sees working for the government as providing stable income, and not a great deal of stress/physical labour.
He's open to some education but of course not the time to do like a bachelors degree.
He's not as in-touch with technology as me (software engineer) but has a decent grasp.

90k+ is a salary floor he's aiming for. He's an Australian Citizen. His current job is casual and he makes 100k, but it's tiring and the odd hours are bad for his mental health. Having some consistent 9-5 work would be good.
He works in NDIS homes, and used to work for a bit as a case manager. Disability support, etc. I've attached his resume.

There's about a year to go till my brother finishes year 12. I have the time and ability to support his goal of finding a relevant job in this roughly 1 year timeframe. I'm aware there is a specific system of how APS applications and jobs work.
Can you help me understand how I can best support his goals? I'm willing to put in lots of time and effort.
Ask any clarifying questions first.

he's been working as aged care support for the disabled in an NDIS home I think Aruma.

I think he'd prefer desk-based work rather than the rigamarole of physically going out again hands-on style dealing with that. He left because the company no longer needed him.

He can confidently use computer programs after he is comfortable with a specific system.
He can write up emails, notes, etc and his English is good - but not native level.
He probably would be okay learning different systems but would dislike constantly having to deal with new things (such as I keep having to do as a software engineer).

He would enjoy program administration, asssment, compliance, policy work, leadership. Although I don't know how likely leadership would be or stuff like compliance since he doesn't have experience in those.
the 90k is not super strict, I think he'd be open to 85k or similar. APS5/6 might be good starting points. But it feels weird directing him to roles that university grads roll off onto after just 1 year of the government graduate programs.

His social work qualifications are currently recognised and if not he can just renew them. He of course has basic things like working with vulnerable people.

His lifestyle priorities are low stress predictable hours. Hybrid work is not too important. no physical care/duties would be very preferred. long-term security would also be nice.

I don't think he'd be willing to begin a Canberra job while being in Sydney. He'd definitely be willing to go for interviews, get practice, etc. If something great came up, there may be considerations.


3.
Aside from this 'mode' feature for preparing for and finding work for different areas, as a software engineer I've been playing around with the Dia browser and I really like the 'briefings' feature. You basically connect slack, atlassian, etc - and you get a daily breifing on tasks you should try completing today.
I'd like to run with this idea and take it a lot further in my platform. It should
Note that this is like a new tab in the software engineer mode - call it 'job'.
expansion upon the Dia idea: I work between many different softwares for my job as a software engineer/cybersecurity engineer. Cursor, GitHub, Jira, Notion, Slack, Outlook, etc. Often there's a well defined task, for which I use AI in cursor to fix the problem, create a PR, approve PRs, etc. I have a feeling I can automate my work by using MCPs/APIs to connect these different tools.
I typically use Notion to take notes. I have a specific structure I follow - under 'Sportsbet' page, I have a section for my second rotation in terms of 'weeks'. Monday-Friday are sections and content in a day is indented to that day. These can be notes on stuff I did, musings, etc.
The user should be able to connect apps they choose (such as slack, notion, etc). There should be a 'connected' and 'not connected' section with icons for the companies.

On the home page, I should have a generated 'daily briefing' similar to how Dia does it - on things I have to work on today.
On the actual 'job' subpage, I''m still not 100% sure how to structure things. But the key idea is automation. So if I have 3 Jira tickets assigned that I need to do by this sprint, maybe reading the specific tasks, seeing what repo it applies to - maybe some cursor AI integration and AI prompts to send. Maybe drafting a PR. These are all just ideas and not to be implemented now. My work is of course more than just Jira tickets and having a system that encompasses my work would be awesome. For now, lets discuss the plan, ideas, etc.

There could even be a suggested calendar that is integrated with the timeline. This could become like an ical subscription or something that I can subscribe to from outlook. And I could even consolidate my 'long term timeline' and 'timeline' into 1 thing on the homepage.

4.
Remove github auth, and implement just a simple email sign-up system.
Can host on like Pi instead of something like clerk. Supertokens could be something to look into


5.
potentially remove the 'staging' environment to simplify things?

6.
add a warning when approaching any free tier limits from the things I'm using.
The one currently in my mind is R2 storage - but there could be others.

7.
by default there should be no other empty tabs for the learn subpage like 'System design' - the use can create them if they want. The default one should be the DSA & Python. that's it.
