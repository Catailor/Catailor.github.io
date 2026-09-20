const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests/browser',timeout:30000,workers:1,reporter:'list',outputDir:'.studio/test-results',use:{viewport:{width:1440,height:900},headless:true,launchOptions:process.env.STUDIO_CHROME?{executablePath:process.env.STUDIO_CHROME}:{},screenshot:'only-on-failure',trace:'retain-on-failure'}});
