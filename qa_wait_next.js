setTimeout(() => {
  const { execSync } = require("child_process");
  execSync("node D:\\personal\\projects\\Music_cont\\qa_final.js", { stdio: "inherit" });
}, 90000);
console.log("waiting 90s for Pages d2620d6...");
