function copyInstallCommand(button) {
	const command = document.getElementById("install-command").textContent;
	navigator.clipboard.writeText(command).then(() => {
		const original = button.textContent;
		button.textContent = "Copied!";
		setTimeout(() => {
			button.textContent = original;
		}, 1500);
	});
}