# openagentic compose — post-install capability TEST (api key + docker), green-on-black.
# Render: vhs tests/demos/compose-test.tape   (needs a healthy stack; admin pw DemoPass123!)
Output tests/demos/compose-test.gif
Output tests/demos/compose-test.mp4

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 15
Set Width 1500
Set Height 940
Set Padding 22
Set TypingSpeed 35ms
Set Theme { "name": "phosphor", "background": "#000000", "foreground": "#00FF66", "cursor": "#00FF66", "selection": "#00351A", "black": "#000000", "red": "#FF5555", "green": "#00FF66", "yellow": "#D7FF55", "blue": "#5599FF", "magenta": "#FF55FF", "cyan": "#55FFFF", "white": "#CFE8CF", "brightBlack": "#1F5F3F", "brightRed": "#FF6E67", "brightGreen": "#5AF78E", "brightYellow": "#F4F99D", "brightBlue": "#6699FF", "brightMagenta": "#FF92D0", "brightCyan": "#9AEDFE", "brightWhite": "#EAFFEA" }
Set CursorBlink true

Type "#  openagentic — compose deploy: prove it's up + working (admin API key + docker)"
Enter
Sleep 1200ms
Type "cd /home/trent/agenticwork/openagentic"
Enter
Sleep 400ms
Type "bash tests/demos/compose-demo.sh"
Enter
# the script: docker ps health -> mint key -> 2 providers -> Bedrock chat -> all 10 MCPs
Sleep 28s
Sleep 3s
