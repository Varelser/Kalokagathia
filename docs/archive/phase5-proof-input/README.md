Real export fixtures

Place browser-exported project JSON files here.



Rules:



keep the original monosphere-project-*.json export file name

after adding or replacing files, run npm run generate:phase5-real-export-manifest

npm run verify:phase5 will compare the folder contents against manifest.json

manifest.json stores file hash and basic summary counts so drift is visible in review
