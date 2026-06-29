// --------------- MESSAGES -------------------

// message with yes, no, close buttons
function createGameMessagePUHandlerYNC(popup)
{
    let yOffset = -70; 
    // add background and panel
    let backGround = popup.scene.add.sprite(0, 0 + yOffset, 'pu_background').setOrigin(0.5).setScale(1);
    backGround.setInteractive(); // block bottom controls
    popup.add(backGround);

    let panel = popup.scene.add.sprite(0, 0 + yOffset, 'message_panel').setOrigin(0.5);
    popup.add(panel);

    // add caption
    popup.captionText = popup.scene.add.bitmapText(0, -60 + yOffset, 'gameFont', 'Caption', 38, 1).setOrigin(0.5);
    //popup.captionText.tint = 0x4f2930;
    popup.add(popup.captionText);

    // add message
    popup.messageText = popup.scene.add.bitmapText(0, -0 + yOffset, 'gameFont', 'Message', 38, 1).setOrigin(0.5);
    //popup.messageText.tint = 0x4f2930;
    popup.add(popup.messageText);

    // add buttons
    popup.addButton('okButton','middle_button', 'middle_button_hover', false, -100, 130 + yOffset);
    popup.addButton('noButton','middle_button', 'middle_button_hover', false, 100, 130 + yOffset);
    popup.addButton('exitButton','exit_button', 'exit_button_hover', false, 235, -190 + yOffset);
    popup['okButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);
    popup['noButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);
    popup['exitButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);

    // add button text
    popup.okText = popup.scene.add.bitmapText(-100, 128 + yOffset, 'gameFont_1', 'OK', 56, 1).setOrigin(0.5);
    popup.okText.tint = 0xFFFFFF;
    popup.add(popup.okText);

    popup.noText = popup.scene.add.bitmapText(100, 128 + yOffset, 'gameFont_1', 'NO', 56, 1).setOrigin(0.5);
    popup.noText.tint = 0xFFFFFF;
    popup.add(popup.noText);
}

// message with close button
function createGameMessagePUHandler(popup)
{
    let yOffset = -70; 
    // add background and panel
    let backGround = popup.scene.add.sprite(0, 0 + yOffset, 'pu_background').setOrigin(0.5).setScale(1);
    backGround.setInteractive(); // block bottom controls
    popup.add(backGround);
    let panel = popup.scene.add.sprite(0, 0 + yOffset, 'message_panel').setOrigin(0.5);
    popup.add(panel);

    // add caption
    popup.captionText = popup.scene.add.bitmapText(0, -60 + yOffset, 'gameFont', 'Caption', 38, 1).setOrigin(0.5);
    //popup.captionText.tint = 0x4f2930;
    popup.add(popup.captionText);

    // add message
    popup.messageText = popup.scene.add.bitmapText(0, -0 + yOffset, 'gameFont', 'Message', 38, 1).setOrigin(0.5);
    //popup.messageText.tint = 0x4f2930;
    popup.add(popup.messageText);

    // add buttons
    popup.addButton('exitButton','exit_button', 'exit_button_hover', false, 235, -190 + yOffset);
    popup['exitButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);
}

// Tevi deposit modal (Story 8.5): caption, amount stepper, status line, deposit/exit buttons.
// Amount adjustment and submission are wired by SlotGame.openDepositModal; this handler only
// builds the Phaser GUI using existing popup assets. No wallet balance is shown or mutated here.
function createTopupPUHandler(popup)
{
    let yOffset = -70;
    let backGround = popup.scene.add.sprite(0, 0 + yOffset, 'pu_background').setOrigin(0.5).setScale(1);
    backGround.setInteractive(); // block bottom controls
    popup.add(backGround);
    let panel = popup.scene.add.sprite(0, 0 + yOffset, 'message_panel').setOrigin(0.5);
    popup.add(panel);

    // caption
    popup.captionText = popup.scene.add.bitmapText(0, -120 + yOffset, 'gameFont', 'Deposit Stars', 38, 1).setOrigin(0.5);
    popup.add(popup.captionText);

    // amount display (Stars)
    popup.amountText = popup.scene.add.bitmapText(0, -40 + yOffset, 'gameFont_1', '0 ★', 72, 1).setOrigin(0.5);
    popup.amountText.tint = 0xFFFFFF;
    popup.add(popup.amountText);

    // status / message line
    popup.messageText = popup.scene.add.bitmapText(0, 40 + yOffset, 'gameFont', 'Ready to deposit Stars.', 30, 1).setOrigin(0.5);
    popup.add(popup.messageText);

    // amount stepper (minus / plus)
    popup.addButton('minusButton', 'button_minus', 'button_minus_hover', false, -200, -40 + yOffset);
    popup.addButton('plusButton', 'button_plus', 'button_plus_hover', false, 200, -40 + yOffset);
    popup['minusButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);
    popup['plusButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);

    // confirm (deposit) and exit — label centered on the button and sized to fit
    popup.addButton('okButton','middle_button', 'middle_button_hover', false, 0, 140 + yOffset);
    popup['okButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);
    popup.okText = popup.scene.add.bitmapText(0, 136 + yOffset, 'gameFont_1', 'DEPOSIT', 34, 1).setOrigin(0.5);
    popup.okText.tint = 0xFFFFFF;
    popup.add(popup.okText);

    popup.addButton('exitButton','exit_button', 'exit_button_hover', false, 235, -190 + yOffset);
    popup['exitButton'].clickEvent.add(()=>{popup.scene.soundController.playClip('button_click', false);}, popup);
}
