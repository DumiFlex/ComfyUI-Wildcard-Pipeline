<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import GuideTable from "./GuideTable.vue";

interface Family {
  title: string;
  intro: string;
  facts: { term: string; desc: string }[];
  pack: string[];
}

const ranking: string[][] = [
  ["1", "Illustrious XL (v0.1 to v3.5, and merges)", "The largest LoRA ecosystem on Civitai (201K+)", "In depth"],
  ["2", "Pony Diffusion V6 (V7 on AuraFlow)", "103K+ models, 2.37B+ images on Civitai", "In depth"],
  ["3", "Flux.1 and Flux.2 (Dev, Klein)", "23 official ComfyUI templates, many LoRAs", "In depth"],
  ["4", "Z-Image Turbo and Base", "The second most opened single ComfyUI template", "In depth"],
  ["5", "Qwen-Image and Qwen-Image 2.1 (and Edit)", "The most opened open-weights template family", "In depth"],
  ["6", "NoobAI-XL (eps and v-pred)", "8K+ resources, the strongest Danbooru coverage", "In depth"],
  ["7", "Wan 2.2 (video)", "12K+ template opens", "In depth"],
  ["8", "SDXL base and realistic SDXL fine-tunes", "2.27M Hugging Face downloads a month", "Short"],
  ["9", "Krea 2", "10.6K template opens, released June 2026", "Short"],
  ["10", "LTX-2.x (video)", "26K template opens across versions", "Short"],
  ["11", "Anima", "New and small (733 template opens) but rising among anime users", "In depth"],
  ["12", "SD 1.5", "About 1.6M Hugging Face downloads a month, a legacy LoRA base", "Short"],
  ["13", "Chroma, SD 3.5, HiDream, Animagine, Kolors, Neta Lumina, HunyuanImage, Playground, PixArt, Stable Cascade", "Little data", "One table row each"],
];

const encoderRows: string[][] = [
  ["SD 1.5", "CLIP ViT-L", "75 tokens a chunk", "yes", "yes"],
  ["SDXL, Pony V6, Illustrious, NoobAI, Animagine", "CLIP ViT-L + OpenCLIP bigG", "75 tokens a chunk", "yes", "yes"],
  ["Flux.1, SD 3.5, Chroma", "T5-XXL (with CLIP on Flux.1 and SD 3.5)", "long (Flux.1 up to 512 tokens)", "no", "parsed, weak"],
  ["HiDream", "CLIP + T5 + Llama 3.1", "about 128 tokens", "no", "parsed, untested"],
  ["Flux.2", "Mistral-family LLM", "long", "no", "off (literal text)"],
  ["Qwen-Image", "Qwen2.5-VL", "long, keep under 200 words", "no", "off (literal text)"],
  ["Z-Image", "Qwen3-4B", "long", "no", "off (literal text)"],
  ["Anima", "Qwen3 0.6B", "long", "no", "untested"],
  ["Wan 2.x", "umT5-XXL", "512 tokens", "no", "parsed, untested"],
];

const cfgRows: string[][] = [
  ["SD 1.5, SDXL, Pony, Illustrious, NoobAI, Animagine", "yes", "CFG about 4 to 7", "Short standing negative plus option negatives."],
  ["Flux.1 dev and schnell", "no", "CFG 1; Flux guidance (about 3.5) is a different knob", "Use positive wording, or NAG."],
  ["Flux.2 (Dev, Klein)", "no", "no negative prompt", "Use positive wording."],
  ["Z-Image Turbo", "no", "guidance 0 to 2", "Put exclusions in positive wording or constraints."],
  ["Z-Image Base", "yes", "CFG 3 to 5", ""],
  ["Qwen-Image, Qwen-Image 2.1", "yes, at true CFG above 1", "true_cfg 4; the default negative is a single space", "Lightning setups at CFG 1 ignore it."],
  ["Anima Base / Turbo", "yes / no", "CFG 4 to 5 / CFG 1", ""],
  ["Chroma", "yes", "guidance about 3", "De-distilled, so real negatives work."],
  ["HiDream Full / Dev and Fast", "yes / no", "CFG about 5 / CFG 1", ""],
  ["SD 3.5 Large and Medium / Large Turbo", "yes / no", "CFG 3.5 to 7 / guidance 0 to 1", ""],
  ["Wan 2.2", "yes at CFG above 1", "4 to 8 step accelerated setups run CFG 1", "Then the anti-stillness negative does nothing."],
  ["Kolors, Playground v2.5, HunyuanImage 2.1", "yes", "CFG about 3 to 6.5", ""],
  ["Lightning, Hyper, LCM, Turbo variants", "no at CFG 1", "CFG-preserving Hyper variants run CFG 5 to 8; SDXL Flash 2.5 to 3.5", "Check the variant's card."],
  ["Krea 2", "not documented", "Raw and 8-step Turbo", "Test it; assume Turbo ignores it."],
];

const families: Family[] = [
  {
    title: "Illustrious XL",
    intro: "An SDXL fine-tune by OnomaAI, trained on Danbooru images with Danbooru tags. It is the default choice for anime characters without a LoRA, because it knows thousands of characters by their tag. v2.0 handles 512 to 1536 px and reads short sentences better; v3.5 is a v-prediction model.",
    facts: [
      { term: "Prompt form", desc: "Danbooru tags, comma separated, with spaces instead of underscores (\"long hair\", not long_hair). Parentheses are weight syntax, so escape them in names: \"name \\(series\\)\". Characters work by tag (\"hatsune miku, vocaloid\"). Matching canon colours reinforce a character; contradicting them makes the two fight." },
      { term: "Order", desc: "Quality, count (1girl, solo), character, series, artist, appearance, outfit, pose, expression, setting, light, camera, style. NoobAI's template (below) is the order the whole family follows." },
      { term: "Quality tags", desc: "\"masterpiece, best quality, amazing quality, very aesthetic, absurdres\", or the shorter \"masterpiece, best quality, absurdres\". These are community habits, not an OnomaAI spec. Some merges repeat them at the end." },
      { term: "Rating", desc: "Danbooru rating words (general, sensitive, questionable, explicit) or the merge's own form. Read the merge's page." },
      { term: "Negative", desc: "\"worst quality, low quality, lowres, bad anatomy, bad hands, extra digits, jpeg artifacts, signature, watermark, username\". For more push, weight a tag (\"(bad hands:1.2)\") instead of repeating it." },
      { term: "Settings", desc: "Euler a or DPM++ 2M, CFG about 4 to 7, 20 to 30 steps, SDXL sizes (1024×1024, 832×1216, 1216×832). v-pred versions need v-pred sampling settings." },
      { term: "Mistakes", desc: "Pony score tags (they do nothing here); five artist tags at once (the styles mush together); tags renamed on Danbooru after the model was trained; 60 or more tags; a colour on its own (\"red, dress\") instead of next to its noun (\"red dress\")." },
    ],
    pack: [
      "Write options as tags. Keep a whole prompt at 20 to 40 tags, which is one or two 75-token chunks.",
      "Put the count tag first in the template, before $character.",
      "Keep the quality header in a fixed value, or in the model header derivation from Recommended pack structure.",
      "Prefer one named outfit (\"school uniform\", \"sundress\") per option to a pile of garment tags.",
      "Give each colour its noun inside the option (\"red dress\", \"blue eyes\") and keep two or three colours per image.",
    ],
  },
  {
    title: "Pony Diffusion V6 XL",
    intro: "An SDXL fine-tune trained on about 2.6M images, balanced across anime, cartoon, furry and pony sources and across safe, questionable and explicit ratings. Artist names were removed from training. About half the images had natural-language captions, so short sentences work, but tags are more reliable for specifics.",
    facts: [
      { term: "Score string", desc: "Start every prompt with the full string \"score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up\". The model card says a bare score_9 is much weaker. Never invent scores like score_9.5." },
      { term: "Source tags", desc: "source_anime, source_cartoon, source_furry, source_pony, right after the scores. They steer the style. For human anime, put \"source_furry, source_pony\" in the negative." },
      { term: "Rating tags", desc: "rating_safe, rating_questionable, rating_explicit, after the source tag. Exactly one per prompt." },
      { term: "Order", desc: "Scores, source, rating, count, character, appearance, outfit, pose, expression, setting, light and camera, style." },
      { term: "Settings", desc: "Clip skip 2 (CLIP Set Last Layer at -2 in ComfyUI). Without it you get low-quality blobs." },
      { term: "Negative", desc: "Not needed for good results. Common additions: \"score_4, score_5, score_6, source_furry, source_pony, watermark, signature, artist name\". It sometimes draws fake signatures that negatives can't fully remove." },
      { term: "Realism", desc: "V6 itself is weak at photos. Realism comes from merges and LoRAs, which often want their own tags (such as a photo source tag). Follow the merge's page. For safe images on a mixed merge, put rating_safe in the prompt and rating_explicit in the negative." },
      { term: "Pony V7", desc: "Built on AuraFlow, so Model Info reads it as auraflow. Treat it as a sentence model with an optional tag tail: special tags, then a plain description of the subject, then style, then extra tags. Its special tags are much weaker than V6's, so don't reuse the V6 score string." },
      { term: "Mistakes", desc: "A shortened score string; score tags in the middle; artist names; clip skip 1; Pony LoRAs on an Illustrious checkpoint (different bases, they don't transfer cleanly)." },
    ],
    pack: [
      "The score string is a constant: a fixed value, or the pony branch of the model header derivation.",
      "Make the rating tag come from a $rating driver so it never disagrees with the outfit and pose (see Adult (NSFW) packs).",
      "A source tag can be a small wildcard that a style driver constrains, so \"source_anime\" and \"source_cartoon\" never mix.",
      "Model Info detects V6 by \"pony\" or \"pdxl\" in the file name. Name your merges that way, or add a variant rule.",
    ],
  },
  {
    title: "NoobAI-XL",
    intro: "An Illustrious-based model by Laxhar, trained on Danbooru and e621. It comes in eps and v-prediction versions. Its card gives the most explicit tag order in the anime family.",
    facts: [
      { term: "Template", desc: "\"<1girl/1boy/1other>, <character>, <series>, <artists>, <special tags>, <general tags>, <other tags>\". Special tags are quality, aesthetic and date." },
      { term: "Quality tags", desc: "Ranked by percentile: masterpiece above the 95th, best quality 85 to 95, good quality 60 to 85, normal quality 30 to 60, worst quality 30 and below. \"very awa\" is the top 5% by aesthetic score; \"worst aesthetic\" the bottom 5%." },
      { term: "Date tags", desc: "\"year 2021\", or a period: newest (2021 to 2024), recent, mid, early, old." },
      { term: "Default prefix", desc: "\"masterpiece, best quality, newest, absurdres, highres, safe,\". Some merges add \"very aesthetic, amazing quality, year 2024, very awa\"." },
      { term: "Default negative", desc: "\"nsfw, worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro\". The e621 words keep furry styles out." },
      { term: "Rating", desc: "safe in the prompt and nsfw in the negative by default. Adult work flips them (see Adult (NSFW) packs). Other levels: sensitive, explicit." },
      { term: "Settings (v-pred)", desc: "Euler only (\"other samplers will not work properly\"), CFG 4 to 5, 28 to 35 steps, about 1 MP. A v-pred checkpoint needs v-prediction sampling (ModelSamplingDiscrete set to v_prediction with zsnr) unless the loader sets it." },
      { term: "Mistakes", desc: "Asking for a retro look (year 2005) while the negative holds \"old, early\"; animal words pulling anthro styles; Pony score tags." },
    ],
    pack: [
      "Model Info names it noobai when \"noob\" is in the file name. The variant rule sits above Illustrious because NoobAI files often mention both.",
      "Put the prefix in the noobai branch of the model header, and the default negative as that branch's Add to negative.",
      "If an era wildcard rolls date tags, take \"old, early\" out of the negative, or the two cancel.",
      "For real animals, add \"no humans, animal focus\" and keep the e621 words in the negative.",
    ],
  },
  {
    title: "Flux.1 and Flux.2",
    intro: "Black Forest Labs' models read full sentences. Flux.1 dev and schnell use CLIP-L plus T5-XXL and are guidance-distilled, so they run at CFG 1. Flux.2 (Dev and Klein) uses a Mistral-family text encoder.",
    facts: [
      { term: "Prompt form", desc: "Full sentences, not tag lists. BFL's frame is Subject, Action, Style, Context (setting, light, time, mood). The model pays more attention to early words, so the subject goes first. 30 to 80 words suits most scenes." },
      { term: "Negative", desc: "None. At CFG 1 the negative has no effect; wire an empty encode or ConditioningZeroOut. Say what you want instead (\"an empty street\"). If you need a real negative, the built-in NAGuidance node restores it." },
      { term: "Weights", desc: "Flux.1 parses \"(word:1.2)\" but the effect is weak; rephrase (\"a vivid red dress, the brightest thing in the frame\"). Flux.2 turns weights off, so the brackets reach the model as text." },
      { term: "Text in the image", desc: "In double quotes, short: a sign that reads \"OPEN LATE\"." },
      { term: "Two boxes", desc: "CLIPTextEncodeFlux has clip_l and t5xxl boxes. The same text in both is fine; some put a short tag summary in clip_l." },
      { term: "Flux.2 extras", desc: "Hex colours tied to an object work (\"a #1E90FF umbrella\"). Structured JSON prompts are supported; the field names in community guides are conventions, not a fixed schema." },
      { term: "Mistakes", desc: "Tag soup; weight stacks; negative boxes that do nothing; \"masterpiece, 8k\" (mostly ignored); \"beautiful, perfect\" instead of describing light and texture, which gives the plastic-skin look." },
      { term: "Adult content", desc: "Base Flux.1 lacks explicit anatomy. It is a poor default for an explicit pack." },
    ],
    pack: [
      "Write options as phrases (\"a weathered leather jacket\"), not tags, and join them with a combine into sentences.",
      "A prose skeleton: \"$subject, $action. $outfit. $place, $light. $camera, $style.\"",
      "Option negatives and $negatives do nothing here. Put exclusions into positive wording and constraints.",
      "Keep weights out of option text for Flux.2.",
      "A Flux.2 JSON prompt can be a combine that writes the object from variables. Keep the keys stable and keep \"|\" out of it, since {a|b} is inline-pick syntax.",
      "Model Info reads both Flux.1 and Flux.2 as flux. Use $model_variant (a rule on the file name) to tell them apart.",
    ],
  },
  {
    title: "Z-Image (Turbo and Base)",
    intro: "Alibaba Tongyi's model with a Qwen3-4B text encoder (loaded with the Lumina2 clip type in ComfyUI). Turbo is the popular one: about 9 steps, and no real CFG.",
    facts: [
      { term: "Prompt form", desc: "Long, detailed natural language works best. It renders text well; quote it." },
      { term: "Turbo", desc: "Official guidance is 0; ComfyUI users run CFG 1 to 2. The negative does nothing." },
      { term: "Base", desc: "CFG 3 to 5, and negatives work." },
      { term: "Weights", desc: "Off. \"(word:1.2)\" reaches the model as literal text. Write emphasis in words." },
      { term: "Mistakes", desc: "Tag lists; weight brackets; relying on a negative on Turbo." },
    ],
    pack: [
      "Long rolled phrases are fine here, so recipe wildcards with several @{} parts suit it.",
      "On Turbo, say \"a clean plain background\" or \"plain clothing\" in the prompt, or use a constraint, instead of a negative.",
      "Model Info may read it as lumina2 or under its own class name. Check the Model Info node's output once and pin the variant.",
    ],
  },
  {
    title: "Qwen-Image and Qwen-Image 2.1",
    intro: "Alibaba's models use a Qwen vision-language encoder. ComfyUI wraps your prompt in a system line: \"Describe the image by detailing the color, shape, size, texture, quantity, text, spatial relationships of the objects and background\". That line is a good hint at the order it wants. Qwen-Image 2.1 (2026-09-20, about 7B) is one model for generation and editing, takes up to 10 reference images and outputs 2K.",
    facts: [
      { term: "Prompt form", desc: "Sentences, under 200 words. The style can lead (\"Art poster design: ...\"), then the subject, background, palette and finish. Spatial wording works: \"on the left ..., on the right ..., facing each other\"." },
      { term: "Text", desc: "Its strength, including Chinese and Japanese. Quote the text, give its position and style, and never translate it." },
      { term: "Suffix", desc: "The official examples end with \", Ultra HD, 4K, cinematic composition.\"" },
      { term: "Negative", desc: "The default is a single space. It works at true CFG above 1 (the official setting is true_cfg 4, 50 steps). Lightning setups at CFG 1 ignore it." },
      { term: "Weights", desc: "Off: brackets reach the model as text." },
      { term: "Editing", desc: "Say what to change and what to keep: \"change the jacket to red leather, keep the face, pose and background\". In 2.1 a transparency (RGBA) cue gives cut-outs." },
      { term: "Licence", desc: "2.1 is under a research licence. Check the card before commercial use." },
    ],
    pack: [
      'A prose skeleton with the caption in quotes: $style: $subject wearing $outfit, $place. A sign reads "$caption". $light.',
      "Keep the suffix as a fixed value, so a model header can drop it for other families.",
      "For edit workflows, a wildcard fills the \"change\" slot and the \"keep\" part is fixed text in the template.",
      "Model Info reads Qwen-Image as qwen_image. Check 2.1 once on the node and pin the variant if it reads differently.",
    ],
  },
  {
    title: "Anima",
    intro: "A 2B anime model by CircleStone Labs with Comfy Org, built on NVIDIA Cosmos-Predict2, with a Qwen3 0.6B text encoder and the Qwen-Image VAE (about 7 GB of VRAM). Base v1.0 came out on 2026-05-15; Turbo and Aesthetic v1.0 in July 2026.",
    facts: [
      { term: "Prompt form", desc: "Tags and sentences mixed, in any order. Write at least two sentences. Name the character first, then describe them." },
      { term: "Prefix", desc: "The base is not aesthetic-tuned, so start with \"masterpiece, best quality, score_7, safe,\" and change the rating tag as needed. Score tags use underscores, like Pony V7." },
      { term: "Negative", desc: "\"worst quality, low quality, score_1, score_2, score_3, artist name\"." },
      { term: "Base settings", desc: "CFG 4 to 5, 30 to 50 steps, the er_sde sampler." },
      { term: "Turbo settings", desc: "CFG 1 (the negative is ignored), 8 to 12 steps." },
      { term: "Weak spots", desc: "Photorealism and long text in the image." },
      { term: "Licence", desc: "Non-commercial. Check the card before you share or sell output." },
    ],
    pack: [
      "The model header's anima branch writes the prefix. The rating word comes from $rating, not typed into the prefix.",
      "Options can be tags; the template can add a sentence of context around them.",
      "Model Info probably reads it as cosmos. Pin the variant to anima, or add a rule matching \"anima\" in the file name.",
      "On Turbo, the safe guard and every exclusion must be positive wording or constraints.",
    ],
  },
  {
    title: "Wan 2.2 (video)",
    intro: "Wan uses a umT5-XXL encoder with room for 512 tokens. A video prompt needs things an image prompt never has: motion, a camera move, and a negative against stillness.",
    facts: [
      { term: "Prompt form", desc: "Prose, 80 to 100 words. Simple, direct verbs. One clear action per clip; several moves muddy the result." },
      { term: "Order", desc: "Style or medium, subject, appearance and outfit, expression, pose and motion, background, texture, then shot size and angle, then the camera move." },
      { term: "Camera", desc: "One move per clip: slow push-in, pan left, tracking shot, orbit, crane up, handheld. Say \"static camera\" when you want none." },
      { term: "Negative", desc: "The official default is a long Chinese list that fights garish colour, overexposure and, unlike any image negative, stillness (\"static\", \"motionless\"). Copy it as is. 4 to 8 step accelerated setups run CFG 1 and ignore it." },
      { term: "Image to video", desc: "The image already supplies the look. Prompt the motion, not the appearance: subject action, then one camera move, then pace." },
      { term: "Language", desc: "The first-last-frame model was trained mainly on Chinese pairs, so Chinese prompts are recommended there." },
    ],
    pack: [
      "Add an $action wildcard and a $camera_move wildcard that image packs don't have.",
      "Hold $character across a Loop run and let $action and $camera_move roll per clip, so each frame is one shot of a shot list.",
      "Keep the official negative in a fixed value, and only count on it at CFG above 1.",
      "Model Info reads it as wan.",
    ],
  },
];

const shortFamilies: Family[] = [
  {
    title: "SDXL base and realistic SDXL fine-tunes",
    intro: "Two CLIP encoders, 75-token chunks, about 1 MP sizes (1024×1024, 832×1216, 1216×832).",
    facts: [
      { term: "Prompt form", desc: "Short natural sentences plus style keywords. Keep the subject in the first chunk." },
      { term: "Order", desc: "Subject and action, appearance, setting, light, camera, style." },
      { term: "Negative", desc: "Short: \"lowres, blurry, watermark, text, deformed\". Don't paste a whole SD 1.5 negative." },
      { term: "Two boxes", desc: "CLIPTextEncodeSDXL has text_g and text_l. Use the same text in both; the labels differ between tools, so don't rely on a style box and a content box." },
    ],
    pack: ["Phrase options (\"a linen summer dress\") work on both realistic fine-tunes and base. Base SDXL is weak at explicit anatomy; adult work happens on fine-tunes."],
  },
  {
    title: "SD 1.5",
    intro: "One CLIP encoder, 512 px native. Most real use is through fine-tunes: anime ones trained on Danbooru tags, photo ones on captions.",
    facts: [
      { term: "Prompt form", desc: "Comma-separated keyword phrases: subject, medium, style, details, colour, light. You don't need every kind." },
      { term: "Negative", desc: "Benefits most from a standing negative (\"lowres, bad anatomy, bad hands, extra digits, worst quality, low quality, jpeg artifacts, watermark, signature, text\") or a negative embedding such as EasyNegative." },
      { term: "Settings", desc: "512×512 or 512×768, then hires fix. Anime fine-tunes use clip skip 2." },
      { term: "Mistakes", desc: "\"trending on artstation, 8k, octane render\" filler eating the short window; more than one subject; sizes far from 512." },
    ],
    pack: ["Keep option text short; the whole prompt should fit one or two chunks. A negative embedding goes in the standing negative or an option's negative, so it follows usage."],
  },
  {
    title: "Krea 2",
    intro: "A 12.9B model with Raw and 8-step Turbo versions, released 2026-06-22 and native in ComfyUI. No official prompting guide was found, so this is inferred.",
    facts: [
      { term: "Prompt form", desc: "Treat it as a natural-language model: Flux-style sentences." },
      { term: "Negative", desc: "Test it. Assume the Turbo version ignores it." },
    ],
    pack: ["Build it like a Flux pack. Model Info has no rule for it yet, so check what the node reads and pin the variant. Revisit this section as guides appear."],
  },
  {
    title: "LTX-2.x (video)",
    intro: "Lightricks' video models (2.3 and 2.5 are among the most opened ComfyUI templates). No primary prompting source was checked for this guide, so this follows the Wan rules.",
    facts: [
      { term: "Prompt form", desc: "Prose that states the motion and one camera move, as for Wan." },
      { term: "Negative", desc: "Check the template's CFG. Distilled setups at CFG 1 ignore it." },
    ],
    pack: ["Use the same $action and $camera_move slots as a Wan pack. Model Info reads it as ltxv."],
  },
  {
    title: "Chroma",
    intro: "An 8.9B model derived from Flux schnell, using only T5-XXL. It is de-distilled, so it runs with real CFG.",
    facts: [
      { term: "Prompt form", desc: "Long natural-language descriptions; a short tag tail also works (\"cold color palette, muted colors, detailed\")." },
      { term: "Negative", desc: "Works: \"low quality, blurry, deformed, ugly\" plus per-concept words. The card's example runs guidance 3 and 40 steps." },
      { term: "Adult content", desc: "Reported to be trained without a safety filter. Check the card." },
    ],
    pack: ["Write it like Flux, but option negatives and $negatives do work here. Model Info reads it as chroma."],
  },
];

const tableRows: string[][] = [
  ["SD 3.5 Large / Medium", "Sentences; composition terms (bird's eye view, close-up, wide-angle shot); text in double quotes, short", "Start with none, add 5 to 15 words when a defect shows; Large Turbo has none", "Medium: CFG 3.5 to 7, 28 to 40 steps. Large Turbo: 4 steps, guidance 0 to 1. Filtered base, little explicit capability"],
  ["HiDream-I1 (Full, Dev, Fast)", "Sentences, front-loaded; about 128 tokens, the tail is lost", "Full only", "Full: CFG about 5, 50 steps. Dev and Fast are distilled: CFG 1"],
  ["Animagine XL 3.1", "Tags: count, character, series, then the rest; prefix \"masterpiece, best quality, very aesthetic, absurdres\"", "Its default holds \"oldest, early\", which fights year tags", "Rating words safe, sensitive, nsfw, \"explicit, nsfw\". Model Info variant animagine"],
  ["Animagine XL 4.0", "Tags: count, character, series, rating, the rest, then quality LAST (\"masterpiece, high score, great score, absurdres\")", "\"lowres, bad anatomy, bad hands, worst quality, low score, ...\"", "CFG 4 to 7 (5), 25 to 28 steps, Euler a. The one popular tag model with quality at the end"],
  ["Kolors", "Chinese or English sentences (ChatGLM3 encoder)", "Yes", "Guidance about 5 to 6.5, 25 steps"],
  ["Neta Lumina / NetaYume", "Needs a system prompt (Danbooru, natural-language or structured variant); later NetaYume data is tags only", "Yes", "res_multistep, linear_quadratic, 30+ steps, CFG 4 to 5.5. Keep the system prompt in the Templates library"],
  ["HunyuanImage 2.1", "Concise sentences; a refiner stage and a prompt enhancer", "For artefacts", ""],
  ["Playground v2.5", "SDXL-like sentences and keywords", "Yes", "Guidance about 3"],
  ["PixArt, Stable Cascade", "SDXL-era prompting, untested", "Untested", "No data found"],
  ["HunyuanVideo", "Sentences in its encoder's order: theme and subject, attributes and positions, actions and motion, background, light, style, then camera angle and moves", "Short artefact list", "One clear action per clip"],
];

const orderRows: string[][] = [
  ["SD 1.5 (base and photo)", "keywords", "count, character, appearance, outfit, pose, expression, setting, light, camera, style, quality", "end"],
  ["SD 1.5 anime fine-tunes", "tags", "quality, count, character, appearance, outfit, pose, expression, setting, light, camera, style", "start"],
  ["SDXL base", "short sentences", "subject and action, appearance, outfit, expression, setting, light, camera, style", "optional, end"],
  ["Pony V6", "tags", "score string, source, rating, count, character, appearance, outfit, pose, expression, setting, light, camera, style", "start, full string"],
  ["Pony V7", "sentences plus tags", "special tags, plain description, style, extra tags", "start (weak)"],
  ["Illustrious", "tags", "quality, count, character, artist, appearance, outfit, pose, expression, setting, light, camera, style", "start"],
  ["NoobAI", "tags", "quality and date prefix, count, character, series, artist, general tags, other", "start"],
  ["Animagine 4.0", "tags", "count, character, series, rating, everything else, quality", "END"],
  ["Anima", "tags and sentences", "prefix with score and rating, character, then description", "start"],
  ["Flux.1, Flux.2, Krea 2, Chroma", "sentences", "subject, action, style, context (setting, light, camera); quoted text", "none"],
  ["Qwen-Image", "sentences", "style (may lead), subject, appearance, outfit, pose, positions, setting, palette and light, camera, quoted text, suffix", "suffix"],
  ["Z-Image", "long sentences", "subject first, then the scene in detail", "none"],
  ["Wan 2.2, LTX", "sentences", "style, subject, appearance, expression, motion, background, shot, camera move", "none"],
];

const slotOrder: string[][] = [
  ["Head", "Quality or score tags, source, rating", "Family adapter: a fixed value or the model header derivation"],
  ["1", "Count and framing", "`1girl, solo` or \"a woman\""],
  ["2", "Identity", "Named character and series, or an original character's fixed traits"],
  ["3", "Appearance", "Face, eyes, hair, skin, body, an adult marker"],
  ["4", "Outfit", "One coherent outfit, or a clothing state"],
  ["5", "Pose or action", "Plus motion for video"],
  ["6", "Expression and gaze", ""],
  ["7", "Setting", "Plus props"],
  ["8", "Light, time, weather", ""],
  ["9", "Camera and framing", "Plus the camera move for video"],
  ["10", "Style, medium, artist", ""],
  ["Tail", "Quality last (Animagine 4.0), the Qwen-Image suffix", "Family adapter"],
];

const modelInfoRows: string[][] = [
  ["SDXL and its fine-tunes", "sdxl", "noobai, pony, illustrious or animagine from the file name; others empty"],
  ["SD 1.5", "sd15", ""],
  ["SD 3.5", "sd3", ""],
  ["Flux.1 and Flux.2", "flux (both)", "Add a rule to tell them apart"],
  ["Chroma", "chroma", ""],
  ["Pony V7", "auraflow", ""],
  ["HiDream", "hidream", ""],
  ["Qwen-Image", "qwen_image", "Check 2.1 once"],
  ["Z-Image", "probably lumina2", "Check once and pin"],
  ["Anima", "probably cosmos", "Pin, or add a rule for \"anima\""],
  ["Wan, LTX, HunyuanVideo", "wan, ltxv, hunyuan_video", ""],
  ["Krea 2, Kolors, HunyuanImage 2.1", "the model's class name in snake_case", "Check once and pin"],
];

const subjectRows: string[][] = [
  ["Portraits (realistic)", "Framing first (close-up, head and shoulders, half-body), then identity with an adult age (\"a woman in her 30s\"), skin texture, one outfit, expression and gaze, the light setup, then lens and aperture", "Constrain outfit by framing: no shoes in a close-up. \"looking at viewer\" is a very strong default; vary it on purpose"],
  ["Anime characters", "Count tag first; character plus series tag; for an original character, a fixed bundle of hair colour, length, style, eye colour and one accessory", "Hold the identity bundle across a run. Matching canon traits help; contradicting them fights the character"],
  ["Several characters", "A count tag and clearly different traits each; on sentence models \"on the left ..., on the right ...\"", "Two bundle copies with renamed variables; for a strong split, one Assembler per region. Never draw two people's outfits from one shared pick"],
  ["Fashion", "One named outfit, or up to 3 or 4 layers from the base outward, one colour each, accessories last; say open or closed for outerwear", "Constraints for season, formality and era. One top and one bottom, or one piece. Footwear only when the frame shows legs"],
  ["Landscapes", "Foreground, midground, background, sky; time of day and weather are the strongest mood levers; wide lens for vast scenes, telephoto for stacked ridges", "On anime tag models add `no humans, scenery`, or a person appears. One season per image"],
  ["Architecture", "Style, city, hour; two-point perspective or \"vertical lines straight\"; named materials (board-formed concrete, weathered copper)", "\"tilt-shift\" gives the toy-miniature look. Negative `people, cars, text` for clean renders"],
  ["Interiors", "Room, style, materials, palette, light, mood; wide angle at eye level", "A material wildcard tagged by style, and a Style → Material constraint"],
  ["Animals", "Species, breed, coat, age (puppy or adult), action, setting; wildlife framing (telephoto, eye level)", "On Pony and NoobAI, animal words can pull anthro styles: add `no humans, animal focus` and keep the furry words in the negative"],
  ["Food", "Dish, plating, garnish, surface and props, light direction, palette, angle (45-degree or overhead flat lay)", "Name light by direction and colour temperature (\"window light from the side\", \"warm 3200K tungsten\")"],
  ["Products", "Product, material, surface, light setup (softbox, rim), background, lens (macro, 85mm)", "Keep brand names and trademarks out. Quoted label text on text-capable models only"],
  ["Photography vocabulary", "Shot size, angle, lens (35, 50, 85, 135 mm, macro), aperture and depth of field, light setup (Rembrandt, butterfly, rim, softbox), film stock", "Make lens and light their own wildcards and let a Shot → Lens constraint pair them"],
  ["Sci-fi and fantasy", "One or two strong world nouns, then specifics; one material language for armour", "Don't stack genres (\"steampunk cyberpunk solarpunk\"). Keep real nouns and invented nouns in separate vocabularies"],
  ["Pixel art", "\"pixel art style\", a pixel-art LoRA at 0.6 to 0.8, about 128 px, then a nearest-neighbour downscale", "Keep option text short; fine detail words get lost"],
  ["Manga and comics", "`monochrome, greyscale, screentone`, spot colour, `4koma` for strips", "A fixed value for the manga look plus an exclude constraint against colour wildcards"],
  ["Vehicles", "Make or type, era, colour and finish, angle (three-quarter front), setting, motion blur", "An Era → Setting constraint"],
  ["Abstract, patterns, textures", "Medium, palette, motif, symmetry; \"seamless tile\" for patterns", "No subject wildcard at all"],
  ["Logos and icons", "Flat, vector, limited palette, centred, plain background", "Text-capable models only; quote any text"],
  ["Creatures", "Body plan, skin, features, a scale reference, habitat", "A Habitat → Body plan constraint keeps them believable"],
  ["Mecha and hardware", "Frame type, armour style, weapons, markings, pose, setting", "Tag models know `mecha`, `science fiction`"],
  ["Horror", "Atmosphere (fog, low key), subject, setting, palette", "Gore is an adult register: label the pack nsfw and gate it behind a $rating driver"],
  ["Concept art", "\"concept art, matte painting\", composition terms (establishing shot), mood", "Sentences on prose models"],
  ["Children's book illustration", "An art style, not a subject age: watercolour or gouache, soft palette, simple shapes; animal or adult characters by default", "Never mix it with adult vocabulary. Add a hard exclude constraint from this style to any adult register"],
  ["Historical", "Era, region, clothing by era, architecture", "An Era → Clothing constraint. No named real people"],
  ["Cosplay", "\"cosplay\" plus the character name, adult anchors", "No real cosplayers or other real people by name or likeness"],
  ["Typography", "The text in quotes, then font style, placement and background", "`\"$caption\"` in a template works. Keep captions short: long rolled text turns to gibberish on SDXL-family models. Qwen is strong for CJK"],
];

const typeRows: string[][] = [
  ["img2img", "Describe the target image, not the change. Denoise 0.3 to 0.5 keeps the composition; 0.6 to 0.8 restyles", "Roll style and light; keep the subject in fixed values or held picks"],
  ["Inpainting", "Start near denoise 0.5. With \"only masked\", describe only what goes in the mask, but keep the full image's style tags so it blends. Inpaint checkpoints take higher denoise", "WP Image Filter: paint a mask and edit the prompt in the picker; the edited prompt is re-encoded when its clip input is wired"],
  ["Outpainting", "Keep at least 20% overlap. Describe the new scene and background, not the subject again. Flux Fill runs at denoise 1", "A second Assembler that renders only $place, $light and $style"],
  ["Hires fix (two passes)", "Same prompt as the first pass, denoise 0.3 to 0.5 (up to 0.6), latent upscale at most 2×", "WP Var → Bool on a $hires variable switches it per pick; WP Image Filter can gate it on your pick"],
  ["ADetailer and FaceDetailer", "A blank detailer prompt uses the main one. `[SEP]` gives one prompt per detected object, in no fixed order; `[SKIP]` skips one; `[PROMPT]` inserts the main prompt", "Feed it from a second Assembler that renders only face and expression variables. With several people the order can swap, so prefer one shared face prompt. In adult packs it must carry the adult anchors"],
  ["ControlNet", "Start at weight 0.5 to 0.7; pick balanced or \"my prompt is more important\"", "The pose comes from the control image: hide $pose, or switch it off with a derivation on an injected $controlnet value"],
  ["IP-Adapter and style transfer", "Pick the style transfer or precise weight type; the text should still name the subject. Face models mostly ignore text: CFG 3 to 4", "With a style reference, hide the $style wildcard so text and image don't fight"],
  ["Regional prompting", "A base prompt plus one prompt per region (Set Area or Set Mask with Combine; FluxRegionAttention for Flux)", "One Assembler per region, all reading the same Context, so the picks agree"],
  ["LoRA triggers and stacking", "Take the trigger from the model page. Start at 0.7 to 0.8; stack 2 or 3 at 0.4 to 0.8, under about 2 in total; the base family must match", "Put the trigger in the wildcard option that is the LoRA, so pick and trigger travel together. WP Var → Float can feed the strength. Never blocklist or fuzzy-dedupe trigger words in the Cleaner"],
  ["Embeddings", "`embedding:name` in the text, optionally weighted; they only work on the family they were trained for", "Negative embeddings go in an option's negative, so they follow usage"],
  ["Video (Wan i2v)", "Prompt the motion: subject action, one camera move, pace. \"static camera\" for none", "Hold $character; roll $action and $camera_move per frame"],
];

const mechanicsKeys = [
  { term: "Chunks", desc: "CLIP models read 75 tokens at a time. A longer prompt is cut into 75-token chunks that are encoded apart and joined. Attributes that land in different chunks bind loosely, so a long tag prompt quietly loses structure. 40 to 70 tags is already two or three chunks; most good Illustrious prompts are 20 to 40 tags. T5 and LLM encoders don't chunk." },
  { term: "Early words", desc: "Every family gives early words more weight. Put the subject first." },
  { term: "BREAK", desc: "In A1111 and Forge, BREAK starts a new chunk, which keeps one subject's tags together. It is not core ComfyUI syntax: the plain CLIP Text Encode node treats it as a word. Some node packs support it; the core way is two encodes joined with Conditioning (Concat). It means nothing to T5 or LLM encoders." },
  { term: "Weights", desc: "\"(word:1.2)\" raises a word, \"(word:0.8)\" lowers it. ComfyUI blends weighted words against an empty prompt, so the same number can feel different from A1111. 1.05 to 1.4 is the useful range; above 1.5 it tends to burn. Qwen-Image, Z-Image and Flux.2 switch weights off, so the brackets reach the model as text. Escape real parentheses: \"name \\(series\\)\"." },
  { term: "Binding", desc: "Models mix up which words go with which noun. Write each colour next to its noun (\"red dress\"; on tag models the compound tag), use two or three colours per image, and never repeat a tag: a duplicate acts like an uncontrolled weight." },
  { term: "LoRA triggers", desc: "A trigger word wakes a LoRA. Take it from the model page and keep it exactly as written. Start at strength 0.7 to 0.8; stack two or three at 0.4 to 0.8 each, under about 2 in total. A LoRA only works on the base family it was trained for." },
  { term: "Embeddings", desc: "\"embedding:name\" (or \"(embedding:name:1.2)\") in the text. Like LoRAs, they belong to one family. Negative embeddings such as EasyNegative go in a negative." },
];

const mistakes: string[][] = [
  ["Contradicting tags (smile and crying, nude and jacket, from behind and looking at viewer)", "A muddled, random result", "Constrain or derive the slots that depend on each other"],
  ["Tag soup (60+ tags, many colours)", "Colour leak; tags past the second chunk ignored", "About 40 tags at most, 3 colours at most, colours next to their nouns"],
  ["Duplicates", "Uncontrolled emphasis", "WP Prompt Cleaner after the Assembler (the Assembler never dedupes)"],
  ["Too many subjects", "One vanishes or two fuse", "Two at most without regional tools"],
  ["Another family's special tags", "Wasted tokens, odd style", "A model header per family"],
  ["Weight brackets on Qwen, Z-Image or Flux.2", "Literal \"(…:1.2)\" in the prompt", "Write emphasis in words"],
  ["Negatives on CFG 1 models", "Nothing happens", "Positive wording, constraints, or NAG"],
  ["A huge generic negative", "Cancels things you asked for", "A short standing negative plus option negatives"],
  ["No count tag", "Extra people", "`1girl, solo` or \"a single woman\" first"],
  ["Detail the frame can't show (shoes in a portrait)", "Changed crops, colour bleed", "Constrain outfit and pose by framing"],
  ["A video prompt without motion or camera", "A static clip", "Motion and camera-move slots"],
  ["Pony's score string cut to score_9", "Weak quality", "The full string"],
];
</script>

<template>
  <DocPage
    group="Guides"
    title="Writing prompts for your model"
    icon="pi pi-pencil"
    tone="neutral"
    blurb="Each model family wants its prompt written its own way. What to write, in which order, which settings matter, and what that means for how you build a pack."
  >
    <DocSection title="Pick your model first">
      <p>Find your model, then write your options in its style:</p>
      <ul>
        <li><b>Tags, comma-separated</b> (<i>1girl, red dress, smiling</i>): Illustrious, NoobAI,
          Pony V6, Animagine and SD 1.5 anime models.</li>
        <li><b>Sentences</b> (<i>a woman in a flowing red dress, smiling</i>): Flux, Krea 2,
          Chroma, Qwen-Image, Z-Image, SD 3.5, HiDream and video models like Wan and LTX.</li>
        <li><b>A bit of both:</b> SDXL base, Pony V7 and Anima.</li>
      </ul>
      <p>
        Tag models also want quality tags (Pony's score tags, Illustrious's "masterpiece, best
        quality") and usually a negative. Most sentence models skip the negative. The sections
        below go family by family; <DocRef id="wp-model-info" /> lets one pack switch between
        them.
      </p>
    </DocSection>

    <DocSection title="Read this first">
      <p>
        A wildcard pack is a prompt writer. The same pack can render tags for an anime model or
        sentences for a prose model, but only if you build it with the target family in mind.
        Most of the work is in three choices: the <b>dialect</b> (tags or sentences), the
        <b>order</b> of the parts, and whether the model uses a <b>negative</b> at all.
      </p>
      <DocCallout variant="warn">
        Model popularity below was gathered on 2026-10-15 from ComfyUI's official template usage,
        Civitai ecosystem counts and one Hugging Face download report. Civitai and Hugging Face
        couldn't be read directly, so the numbers are rough. This field moves fast: recheck them
        before you rely on them.
      </DocCallout>
      <GuideTable :head="['Rank', 'Family', 'Why', 'Depth here']" :rows="ranking" />
      <p>
        <b>For your pack:</b> decide your target family before you write options. Tag models want
        options like "red dress"; prose models want "a flowing red silk dress". If you serve both,
        keep options as short phrases and let the template and the model header do the rest.
      </p>
    </DocSection>

    <DocSection title="How the text encoder reads your prompt">
      <DocKeyList :items="mechanicsKeys" />
      <GuideTable :head="['Family', 'Text encoder', 'Length', '75-token chunks', 'Weights']" :rows="encoderRows" />
      <p><b>For your pack:</b></p>
      <ul>
        <li>Keep weight brackets out of option text in a pack meant for several families. Write emphasis in words, or weight in a family-specific fixed value.</li>
        <li>On CLIP models, a whole prompt of 20 to 40 tags fits the budget. Use the variation budget below to keep it there.</li>
        <li>Put a LoRA's trigger inside the option that stands for the LoRA, so they always come together. Never let the Cleaner's blocklist or fuzzy dedupe touch trigger words.</li>
      </ul>
    </DocSection>

    <DocSection title="Negatives and CFG">
      <p>
        A negative prompt only works when the sampler runs real classifier-free guidance, which
        means CFG above 1. Distilled and few-step models run at CFG 1, where the negative is not
        used at all.
      </p>
      <GuideTable :head="['Family', 'Negative used?', 'Settings', 'Notes']" :rows="cfgRows" />
      <DocCallout variant="tip">
        Negatives work best on a concept the prompt actually invites ("hat" when the outfit tends
        to bring one). A long generic negative dilutes itself and can cancel things you asked for.
        To move the camera, say it in the prompt: a negative is not a composition tool. The
        built-in NAGuidance node brings negatives back on some distilled models.
      </DocCallout>
      <p><b>For your pack:</b></p>
      <ul>
        <li>Every pack feature that relies on negatives (option negatives, <code>$negatives</code>, a safe guard, the negative template) needs CFG above 1. Say so in the pack's description.</li>
        <li>For CFG 1 models, put exclusions into positive wording ("an empty street", "plain background") and into constraints.</li>
        <li>Option negatives follow usage: they reach the negative output only when the template renders that variable. That is the right home for a word one option invites.</li>
      </ul>
    </DocSection>

    <DocSection v-for="f in families" :key="f.title" :title="f.title">
      <p>{{ f.intro }}</p>
      <DocKeyList :items="f.facts" />
      <p><b>For your pack:</b></p>
      <ul>
        <li v-for="n in f.pack" :key="n">{{ n }}</li>
      </ul>
    </DocSection>

    <DocSection v-for="f in shortFamilies" :key="f.title" :title="f.title">
      <p>{{ f.intro }}</p>
      <DocKeyList :items="f.facts" />
      <p><b>For your pack:</b> {{ f.pack.join(" ") }}</p>
    </DocSection>

    <DocSection title="Other families">
      <GuideTable :head="['Family', 'Prompt', 'Negative', 'Notes']" :rows="tableRows" />
      <p>
        <b>For your pack:</b> for any family not listed, start from its model card's example
        prompts, copy their order into an Assembler template, and save it in the Templates
        library. Fixed strings a model needs (a system prompt, a suffix) are fixed values or
        templates, never wildcards.
      </p>
    </DocSection>

    <DocSection title="Section order per family">
      <GuideTable :head="['Family', 'Dialect', 'Order', 'Quality tags']" :rows="orderRows" />
      <p>
        One slot order serves every family. Only the head and the tail change, and the sentence
        families join the slots into clauses instead of a tag list:
      </p>
      <GuideTable :head="['#', 'Slot', 'Notes']" :rows="slotOrder" />
      <p>
        <b>For your pack:</b> make one variable per slot, in this order, and write one Assembler
        template per dialect (one tag skeleton, one prose skeleton). Save both in the Templates
        library. The head and tail come from the model header (see
        <DocRef id="pack-structure" />), driven by WP Model Info.
      </p>
    </DocSection>

    <DocSection title="What WP Model Info reports">
      <p>
        <DocRef id="wp-model-info" /> writes <code>$model_family</code> from the model's class
        and <code>$model_variant</code> from rules on the file name. The family list was written
        before some newer models, so check what the node reads for yours once:
      </p>
      <GuideTable :head="['Model', '$model_family', '$model_variant']" :rows="modelInfoRows" />
      <p>
        <b>For your pack:</b> drive the header from <code>$model_variant</code> where you can,
        with <code>$model_family</code> as the fallback. A merge without "noob", "pony" or
        "illustrious" in its file name is not detected: rename it, add a rule, or pin the variant
        on the node.
      </p>
    </DocSection>

    <DocSection title="Subjects">
      <GuideTable :head="['Subject', 'What to name, in order', 'In your pack']" :rows="subjectRows" />
      <p>
        <b>For your pack:</b> the subject decides which slots exist. A landscape pack has no
        outfit slot; a product pack has no expression. Build only the slots the subject needs and
        constrain the ones that depend on framing.
      </p>
    </DocSection>

    <DocSection title="Prompt types beyond text to image">
      <GuideTable :head="['Type', 'How to prompt', 'With Wildcard Pipeline']" :rows="typeRows" />
      <p>
        <b>For your pack:</b> second passes usually want a smaller prompt than the first. A second
        WP Prompt Assembler reading the same Context renders just the slots that pass needs, and
        its picks match the first pass because they come from the same run.
      </p>
    </DocSection>

    <DocSection title="Variation without incoherence">
      <p>
        Each slot that varies on its own multiplies the chance of a bad combination. A good
        budget is 2 to 4 varying slots per image (say pose, expression, camera and one prop), with
        everything else fixed or held.
      </p>
      <ul>
        <li><b>Fixed for a whole set:</b> the family head, the subject count, the character's identity (face, hair, eyes, body, the adult marker), the style.</li>
        <li><b>Fixed within a scene:</b> the outfit, the setting, the light.</li>
        <li><b>Varies per image or frame:</b> pose, expression, camera, small props.</li>
        <li>Vary inside a slot with curated options of one kind (ten poses that all fit the framing), not mixed lists.</li>
        <li>A fixed seed doesn't keep a character the same once the prompt changes. Hold the picks instead.</li>
      </ul>
      <p>
        <b>For your pack:</b> use Hold across run for identity and style under a WP Context Loop,
        weights for how often each option shows, constraints to forbid bad pairs and a fallback
        for when a constraint leaves nothing.
      </p>
    </DocSection>

    <DocSection title="Common mistakes">
      <GuideTable :head="['Mistake', 'Symptom', 'Fix']" :rows="mistakes" />
      <p>
        <b>For your pack:</b> run the Test Runner over many seeds and read a handful of full
        prompts. Most of these mistakes are visible in the text before you render a single image.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'pack-structure', label: 'Recommended pack structure', icon: 'pi pi-th-large', tone: 'neutral' },
          { id: 'adult-packs', label: 'Adult (NSFW) packs', icon: 'pi pi-shield', tone: 'neutral' },
          { id: 'wp-model-info', label: 'WP Model Info', icon: 'pi pi-microchip', tone: 'neutral' },
          { id: 'wp-prompt-cleaner', label: 'WP Prompt Cleaner', icon: 'pi pi-ban', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
