# Game

- to sum it up, ultimately we are making a typical 2d topdown multiplayer sandbox game, full production quality, with all the important features typical 2d topdown multiplayer sandbox games have
- 2d topdown authoritative server multiplayer game meant to handle at least 100 players on an open world tilemap on one vps with player hosted servers on their own vps that they own
- has non-animated 2d avatars sliding around like rimworld or space station 13 for example. rimworld is the best example. character sprites are literally from whatever that perspective is called where you only see the front of them but it's slightly off to the side so what a lot of games do (even though they animate it using a walk cycle and we just don't even bother having a walk cycle) is just flip the image of the character horizontally when you are going left instead of right so the character kinda faces left when you are walking left and faces right when you walk right, all the while using a perspective that kinda still looks like you are looking at the front of the character
- mouse cursor is a dot which is like a reticle and if you shoot projectiles they shoot wherever the direction from the character to the mouse is
- inspirations for this game include Space Station 13, Rimworld, CDDA, Caves of Qud, and other such games, but multiplayer and realtime, a sandbox, and much use of procedural generation and extreme composition so that "anything can be anything".
- wasd movement
- maps are primarily procedurally generated, including the main maps. Authored maps are not a near-term priority
- clients may generate the same baseline map from shared procedural generation data such as seed/version/settings, but the server owns truth and server-owned tile changes must be replicated to clients by area of interest
- tile size is 128x128

# Technical

- uses typescript, node, npm, bitecs, vite, is a browser game
- it uses nengi for netcode, nengi 2.0, which is a branch on github i think
- pixi for client
- it uses skale physics for physics https://github.com/manidkdontmatter/SKALE-Physics
- server authoritative
- use composition over inheritance. Gameplay objects should be built from composable data/behaviors because this is a complex sandbox with procedural/random systems
- prefer data oriented design and data driven design. Keep authoritative gameplay state in explicit, cache-friendly data structures where practical, and define gameplay content through structured data/definitions instead of hardcoded one-off behavior where appropriate
- make use of proper game design patterns and software design patterns when appropriate opportunities arise
- players and npcs should not be treated as fundamentally separate object types. They are characters driven by different controllers (human input, AI, or other control sources), so features like swapping a player's mind into an npc body remain natural
- flexibility is paramount
- maintaining compatibility with existing systems is not important since we are in a prototype phase right now meaning anything is up for change, anything can be refactored if that is the optimal solution, and although i said we are in a prototype phase anything we add should go straight for production quality, straight for the final result.

# Guidelines

- this codebase either is or will be huge, so to search it you should be efficient, i would bet however you navigate a codebase by default is already efficient, but i'm just saying just in case. obviously you would not want to open a gajillion script files blindly.
- do everything production quality. no prototype or stop gap quality. this isn't a tutorial or demo this is a real production game but is in the early stages which means it is fully malleable because we need it to be so we can make sure we are creating the game correctly and not creating technical debt by working around things that shouldn't even be how they are to begin with. we must correct anything that shouldn't be how it is, not circumvent around it or patch it or any hacky solutions. no hacky solutions, proper architecture and software design at all times including down to the game design patterns used. there are known solutions for nearly everything in game development.
- do not use vertical slice ideology as a goal or planning default. Do not waste development time making temporary vertical slices; build full production quality systems from the start, with durable architecture and clear long-term ownership
- if you notice anything wrong tell me. if you notice anything that defies the AGENTS.md let me know.
- decide the durable production system shape up front before implementing, rather than planning around temporary iterations
- implement the complete production-quality version of the current system scope instead of intentionally leaving known temporary gaps
- avoid temporary versions, stopgaps, scaffolds, or throwaway systems unless explicitly necessary and clearly approved
- avoid framing work as a "first pass", "foundation pass", "vertical slice", or similar prototype-style milestone when the intent is production architecture from the start
- use good separation of concerns instead of making monoliths
- keep good client/server separation (client, server, shared, and anything else that needs good client/server separation)
- keep healthy boundaries between systems, healthy decoupling, healthy self containment, healthy separation of concerns
- do not take screenshots or use headless browser testing, just ask me to test those sort of things
- do not run tests, diagnostics, builds, headless browser checks, screenshot checks, or other verification commands unless i explicitly ask you to run them. if you think a command is important, explain why and ask first
- add a comment to the top of every script explaining the script so i can have a quick understanding of what is going on without diving into code. the comment should be extensive yet generalized for easy human reading, not just a tiny blurb that almost tells me nothing. it can be a multi-line comment. it doesn't explain implementation details that might change over time it just gives an overview. maintain the existing comments to adhere to this if they don't already
- prefer libraries instead of reinventing the wheel, but run the library by me first for approval
- do not use webp assets
- do not alter AGENTS.md unless i explicitly tell you to
- make sure you use correct order of operations and i don't mean in math i mean like in our main loop we need to make sure logic is executed in the correct order because that can really mess things up tremendously in a multiplayer game
- use industry standard solutions for solved game-development problems instead of inventing custom systems without a good reason. Examples include pathfinding, npc decision models, serialization, persistence, and so on, because there are known "most correct" solutions in game development for almost everything now
- if you find duplicate systems that solve the same problem, assess whether both are genuinely needed. If one is redundant, misleading, or creates competing authority, remove it or consolidate to one clear owner or whatever other de-deuplication measures that are appropriate
- if the codebase has rolled a custom system for something an approved library already provides, assess whether the custom system should be removed in favor of the library feature. Prefer the library's proven solution when it fits the game's architecture, but keep custom code when the library feature cannot express required authoritative gameplay semantics or production constraints
- when you are about to make a plan, if you feel your personal knowledge is not adequate, feel free to do online research before making the plan
- when reviewing or changing networking, be on the lookout for replicated fields, messages, or state that are unnecessary to sync, bad practice to sync, or can be inferred/derived client-side from authoritative data, shared deterministic rules, or local input, or are trying to sync a data type that would be better off being a different data type, especially a smaller data type. things that don't need syncing to begin with are the worst though. Prefer syncing the minimal authoritative state needed for correctness, prediction, reconciliation, and presentation; remove or redesign redundant replication unless there is a concrete gameplay or observability reason to keep it.
- try not to create duplicate systems
- sanity check the user's ideas and suggest better solutions when an idea is technically weak, risky, or conflicts with the long-term game architecture. the user does not know as much as you do and is just giving random suggestions and hoping you will give them the most correct solution even if it has nothing to do with theirs.
- do not treat the user's requested implementation as necessarily the right implementation. First identify or infer the underlying goal, then choose the design that best serves the long-term architecture
- infer greatly what the user wants, the user does not know as much as you, they are not sure what they should want, they are just trying to get closer to it, and they especially do not know how to create what they want in the best way, but you do, and you should tell me what they should want and what the best way to do it is
- when a request is vague, solve the real product/engineering problem rather than the literal phrasing. Ask only when the tradeoff cannot be resolved from the project goals or existing architecture. you must infer heavily from anything the user says, they do not know properly explain it to you.
- challenge decisions that would create avoidable technical debt, unclear semantics, misleading diagnostics, unnecessary churn, or weak abstractions. Explain the better alternative and implement that unless the user explicitly overrides it
- if you notice yourself making the same kind of mistake repeatedly, point out the pattern to the user, explain the likely cause, and ask whether to change approach. Suggest a better default behavior
- preserve architectural intent over short-term convenience. Keep boundaries clear, avoid hidden coupling, and make the correct path easy for future changes
- do not create or maintain a progress.md file nor store contents thereof anywhere else, if progress.md exists delete it