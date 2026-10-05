## General
I plan to run the latex compilation on my raspberry Pi server I have at home eventually. This will be it's own seperate

The subpage buttons at the top that are currently green should be that deep blue colour.

In general, when the user is required to put in a link, if they don't start with 'https://', and are just like example.com, you can pre-pend it so that it's inputted as https://example.com.

edit mode should not persist - if the user clicks away from the subpage, and goes back to it - it should be normal view. 

On mobile, the 'arrow' symbol (↗) gets rendered as the top right arrow emoji (↗️) and it looks bad. Fix this.

the top right work arrow on the landing page is blue and when signed in is pink. Make it cycle through all of the key colours of the site at a medium pace - adjustable with the 'arrow-colour-change-page' parameter. There should also be a multi-coloured glow on the arrow. Keep it aesthetic and tight.

remove: COLIMA STUFF, linux vms, docker containers - 
add: PI STUFF.

I see that for running the latex renderer, you've implemented a docker service running TeX live in docker. This PDF is stored and returned. I see that Colima and such are involved.
I actually have a Raspberry Pi on my home network which I would like to use to do the rendering and heavy work that the code delegates to like a theoretical VM. I believe cloudflare tunnel would be a good starting point. I have created a folder in my Pi for this project: /home/manav/base/work_project.
You can SSH into the Pi with the terminal command 'ssh pi'.


## Home
No need for a seperate goals section in the timeline card below the timeline - remove that. Goals should still be visible in the timeline as it exists now. 
don't use a pastel for goal bars - use similar colours to the rest of the site. If a goal is complete the bar should turn that lime green on the rest of the site.

in the timeline, for me all of the timeline events are represented as dots. Different shapes/colours for different kinds of events e.g. rotated square and orange for interviews.



## Settings
The user should have the option to pick a name rather than defaulting to the github username. This should be used everywhere where relevant.
the toggle to light/dark mode should be a site-theme-matching left and right switch rather than an ugly system drop down.
remove reduce motion option.

## Learn subpage
I'd like to match the style of the leetcode status component on manavdodia.com/learn more closely. Like include the profile photo of the user. Like when I click on a specific day square, the box for details of that day stay even when my cursor moves away (only when I click away does the pop up go away) - it should go away as soon as the user moves the cursor away. Similar to how it's done on manavdodia.com/learn. there doesn't need to be an 'x' option as the window should just dissapear as the user moves their cursor away. 

rename the roadmap to 'Roadmap'. And 'fill in' each box horizontally based on how many questions the user has done. So if the user has done 8/9 questions for the box, the box should be 'filled in' 8/9 of the way horizontally. The 'not filled in' colour can be a lighter shade of the colour currently there.

No need for that drop down for the leetcode username with links to their profile and the refresh button. The refresh should happen every time the user lands on the page similar to how my personal website does it. 

When in edit mode, no need for the pencil icon. The user should be able to just put their cursor on the text and edit. Similar to a word doc. No need for seperate pop-outs everywhere for simple things like editing a title. 
No need to specifically specify a technology glyph. just rely on name matching. Make it comprehensive.

even like when creating a notes section there is this whole popup for name and a save button. Just add a blank one and allow the user to edit it as they wish freely like a word doc. 

similarly, allow the user to drag the topics to arrange their order and remove the up and down arrows for the topics section. No need to have an 'edit topic' button - the user should be able to just put their cursor where the topic is and start editing. remove the functionality for topic descriptions too. If the user wants some text, they can create a section - which also doesn't need a description.

similar for the notes sections - no need for up and down arrows everywhere - just let the user intuitively drage sections around if they choose to do so. All throughout the site have this design philosophy.

instead of treating the learn page as collections of notes, treat it like a notion replacement. the user should be able to freely write notes, indent things, link links, etc. No need for this 'sections' design. Of course they still have to go into edit mode to write stuff. Make sure this is featureful and has auto-save functionality.





## Applications subpage
for the 'On your radar' page, remove the option for 'website' - just the link to the careers page. No need for 'why it interests you' - notes should be like that format (remove the current notes subheading style).

on the applications tab, when hovering over an application - the listing link should highlight blue as the user hovers over it. The 'role' should not highlight blue as it's the same thing as clicking naywhere else on the application row. The 'Status' has like the current step below the status like 'Technical interview' - this should not be there.

If the notes get too long, add a '...' and the user can see more details when clicking into the role. The width if the row should remain constant. 
An application has 'status' and 'recruitment process' - this should be consolidated. The statuses should be Applied, Offer, Accepted, Rejected - a default application/offer recruitment process should be there and the user can optionally add in steps in the middle (such as online assessment) - if the user has added these in, they should become options to click for status (yellow). 
the 'recruitment process' should be simplified. there doesn't need to be its own submenu. Also remove steps 'cancelled', 'skipped', and 'current'. Just completed and planned. Completed shouldn't have a thick green top border - it should just be the simple black border style but in green all around. The first 'planned' step should have the blue pop-out style that is present. the rest of the planned ones should stay normal black border. no need for the dashed lines variant. 

There should be no option to add a date no 'milestone date'. no button to 'sechedule appointment' in the recruitment process. No hyperlink from recruitment process to the appointment. Just a simple date IF an appointment is scheduled for it.

the schedule interview button should be renamed to just 'Schedule'. The appointment MUST be assigned to one of the recruitment process steps. The user is expected to add in the recruitment process step before scheduling an appointment for it. No need for timezone, meeting URL, status, source URL. Just the title, and the date/time. The user is expected to keep notes such as hyperlinks to the relevant email in the notes for the application box. Similar to the recruitment process, there is no need for a further submenu to schedule an appointment. Just do it directly where things are. 

Remove the link between appointments and the 'interviews' tab. No need for links to prepare from the application card, nor have specific tabs for 'upcoming interviews' - the user can choose to make tabs as they wish. Note that the 'upcoming interviews tab should remain - just smaller (company + appointment name (e.g. online assessment) + time). less vertical height needed per card I think.

Also aside from the main website far left scroll, there should be no other scroll bars visible. There is a scroll bar for scrolling down on each application, and a horizontal scroll bar for when the recruitment proces steps need to scroll. These should not be visible and still function as expected. Note to not just make it inivisible, as it might still take up that space where it would have been - just be not visible. make it aesthetically pleasing.

I also don't like that there is occasionally a blue border around elements for focus. When I click elsewhere it dissapears. e.g. when clicking on an application there is a blue border around the X button. When closing the edit application, there is a blue  border around the whole application box. O also dislike when it is intentionally there (e.g. when the user has the search bar in focus). No need for it anywhere. fix this. 

Also whenever there are options to select things such as date, or select an item for a list, or similar the website is using the browser's native picker/date/etc. Use something that is custom and matches the aesthetic of the site.



## Interviews subpage
overall I dislike this style of only highlighting the top section of a container. Just leave it black, or colour it all in. Similar to the design philosophy of most of the rest of the site. this applies to the 'behavioural' subheading (to be removed as defined below anyway) and similar the 'upcoming interviews' section here.

remove the section for past and other appointments.

using the same system as described in the learn subpage, I'd like to be able to arrange tabs as wanted (code can be consolidated).

I don't need seperate sections for notes and resources. Keep it like a notion replacement with features such as tabs, hyperlinking, links, etc. Make sure the editing is featureful and has auto-save functionality. It will only be a notion replacement if it is good. remove the 'resources & notes' idea with ability to add resources and notes sections. Just a freeform text editor. make sure it still looks well integrated with the site and is aesthetic.

The user is able to delete the Behavioural subpage which removes the STAR question bank with no way to get that functionality back. Make sure the Behavioural tab cannot be removed.

Similar to how I've discouraged new 'pop ups' where possible, when the user wants to add a new STAR story, create a blank container representing that story and making the user fill in details. No need for 2 seperate sections 'lessons' and 'other notes' - just keep Lessons.



## Documents subpage
generic 'documents' and resume/cover letter are mashed together. there should be clear seperation. No option to upload resume/cover letter. These should only be generated based on latex. There should be no 'PDF' being stored for these - except for what the latex generator renders. the 'add document' button therefore should move down next to the 'more documents' section - which should be renamed to 'Other documents'.
When there is no resume, just an option to write the resume in latex. Each resume that is not a variant like security should have the option to attach to an application that already exists (connected to the applications tab). This should be in the options when creating a fork. This should be a nice drop down with details. Also which resume is a fork from which resume should be clearly visually visible. And The differences from the resume it was forked from highlighted. Like a tree. With the main Resume at the top. No need to export the source. In edit mode the source should always be expanded - it's like an editor and the rendered result side by side. source on left - rendered output on the right. 
Also the height of buttons 'Resume main' and 'Resume variant' are different - make them the same. The main one should be vertically smaller to match the others.

Also in the more documents section when I go to upload a document why are there so many fields? It should just be name and upload document. There's also no need for there to be an edit option (the user can just delete and re-upload a document). No need for 'intended company', comparision text, if it's a default document (resume/cover letters will be supplied directly from the top 2 respective sections). No need for version history of more documents.
Also there seem to be two borders around the More documents. There is an external white big border (which is expected), but then a darker coloured border also in rounded edges around the document (same colour the whole card turns to on hover) - this second border should not exist. The preview should still fill in up to the point where the second border is - it is ok if some of the sides and such of the document are cut off in the preview. 
similarly, when I click in to see a document in full screen, there is an external card border that is expected - but then also a second border denoting the section the document is presented in. That should not exist. And no need for full screen options - for more documents, resume, cover letter, etc. Remove that button/functionality.

'Your links' should be renamed to 'External links' - and should look/feel like a button rather than a link. This means no underline. Also the 'Website' for 'manavdodia.com should be file-user icon.

Also within the supbages, there should be no scroll bar. It's a little bit of scrolling. The user doesn't need to know where they are. The scroll bar on the very right side for the site makes sense.



## Your Direction subpage
Similar to above, I hate this style of having a bold top coloured section of a container as seen in the cards. match the rest of the direction of the site. Just leave it fully black or wrap around the whole thing with a black shadow (also no bold top part).

there are: career paths, streams & experience, Decisions, and Goals & milestones. I'd like to simplify and consolidate the first 3 - they all mean similar things and function similarly basically 'long term decisions and how to work towards them'. Stuff like software vs cyber, etc. But appropriately and smartly.

I'd also like to simplify how creating/editing works. currently there are LOTS of different fields that mean similar things. The links should be the same size. It should just have a start and end date. No need for Stream / focus, no need for Priority (just keep status - which can replace the current functionality of Priority with the top left bubble). status should be a drop-down of 'Future', 'Exploring', 'Pursuing', 'Achieved'. remove Next step, remove Open questions. Instead of a pop-up appearing, make editing similar and intuitive with just editable fields easily. No need for like the Pencil icon. Still have functionality like adding sections which were previously empty of course.

For goals, yes attaching them to something from the above section is a good idea. Name/Target date/start date make sense. keep target date and start date next to each other same row. For progress measure, have 'LeetCode problems with just target as the option. Remove roadmap problems and 'a number I update'. No need for 'source link'. No need for 'progress and details' to be a drop down - just always visible. There shouldn't be a button to 'edit' a goal - when in edit mode the details should just be editable. delete goal doesn't need to be in a drop down either. progress history should be at the bottom. 