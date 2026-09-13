setTimeout(() => {
  require("child_process").execSync("node D:\\personal\\projects\\Music_cont\\qa_loop1.js", { stdio: "inherit" });
}, 90000);
console.log("waiting 90s for Pages deploy...");
