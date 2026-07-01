 //"use strict";
let slotGame;
let slotConfig;
let coinSpinAnim;
let slotGameLayoutMode;
let slotGameResizeTimer;

function getSlotGameLayoutMode()
{
    return window.innerWidth < window.innerHeight ? 'portrait' : 'landscape';
}

function getSlotGameDimensions(layoutMode)
{
    return layoutMode === 'portrait'
        ? { width: 1080, height: 1920 }
        : { width: 1920, height: 1080 };
}

function createSlotGame()
{
    slotGameLayoutMode = getSlotGameLayoutMode();
    var gameDimensions = getSlotGameDimensions(slotGameLayoutMode);

    // phaser game configuration object
    var gameConfig = {    
        type: Phaser.WEBGL,             // render type
        width: gameDimensions.width,     // game width, in pixels
        height: gameDimensions.height,   // game height, in pixels
        transparent: true,              // without background 
        scene: [SlotGame],              // scenes used by the game  
        audio: 
	   {
			                        // disableWebAudio: true
       },
       scale: {
           // FIT letterboxes on wide viewports (common in Tevi webviews), leaving body
           // background visible beside the reels. ENVELOP fills portrait width edge-to-edge.
           mode: slotGameLayoutMode === 'portrait' ? Phaser.Scale.ENVELOP : Phaser.Scale.FIT,
           autoCenter: Phaser.Scale.CENTER_BOTH
      }
    };
   
    slotGame = new Phaser.Game(gameConfig);                 // game constructor
    window.focus();                                         // pure javascript to give focus to the page/frame 
                                                            // scale  resize();  window.addEventListener("resize", resize, false); - not used
}

function handleSlotGameResize()
{
    var nextLayoutMode = getSlotGameLayoutMode();
    if (nextLayoutMode === slotGameLayoutMode) return;

    clearTimeout(slotGameResizeTimer);
    slotGameResizeTimer = setTimeout(function () {
        if (getSlotGameLayoutMode() === slotGameLayoutMode) return;
        if (slotGame) slotGame.destroy(true);
        createSlotGame();
    }, 250);
}

// window loads event
window.onload = function() {
    createSlotGame();
    window.addEventListener("resize", handleSlotGameResize, false);
}

// SlotGame scene
class SlotGame extends Phaser.Scene{
  
    // constructor
    constructor(){
        super("SlotGame"); // scene key 
    }

    loadSceneConfig()
    {
        slotConfig = slotConfig3x5;
        if (slotConfig.applyLayout) slotConfig.applyLayout(slotGameLayoutMode);
    }

    // method to be executed when the scene preloads
    preload(){
         // create preloader
         var progressBar = this.add.graphics();
         var progressBox = this.add.graphics();
         progressBar.depth = 20;
         progressBox.depth = 19;
         progressBox.fillStyle(0x222222, 1);
         progressBox.fillRect((slotGame.config.width / 2) - 10 - 160, (slotGame.config.height / 2) - 10, 320, 50);
 
         this.load.on('progress', function (value) {
             //console.log(value);
             progressBar.clear();
             progressBar.fillStyle(0xFFEA31, 1);
             progressBar.fillRect((slotGame.config.width / 2) -160, (slotGame.config.height / 2), 300 * value, 30);
         });
                     
         this.load.on('fileprogress', function (file) {
             //console.log('fileprogress: '+ file.src);
         });
 
         this.load.on('complete', function () {
             //console.log('complete');
             progressBar.destroy();
             progressBox.destroy();
         });

        this.updateEvent = new MKEvent();
        this.loadSceneConfig();

        // 1) loading png images, sprite sheets
        slotConfig.sprites.forEach((s)=>{
            if(s.fileName != null) {
            // if(this.textures.exists(s.name))  this.textures.remove(s.name);                                  // uncomment for game with multiple slot scenes
            this.load.image(s.name, "png/" + s.fileName);
            }
        });   // load png textures from png folder
        slotConfig.symbols.forEach((s)=>{
            if(s.fileName != null) {
                // if(this.textures.exists(s.name)) this.textures.remove(s.name);                                // uncomment for game with multiple slot scenes   
                this.load.image(s.name, "png/Symbols/" + s.fileName);
            }   
        });
        slotConfig.symbols.forEach((s)=>{
            if(s.fileNameBlurred != null) {
                // if(this.textures.exists(s.name + 'Blurred')) this.textures.remove(s.name + 'Blurred');        // uncomment for game with multiple slot scenes
                this.load.image(s.name + 'Blurred', "png/SymbolsBlurred/" + s.fileNameBlurred);
            }
        });
        slotConfig.symbols.forEach((s)=>{
            if(s.animation != null) {
                // if(this.textures.exists(s.name + 'Sheet')) this.textures.remove(s.name + 'Sheet');            // uncomment for game with multiple slot scenes
                this.load.spritesheet(s.name + 'Sheet', "png/SymbolsSheet/" + s.animation, {frameWidth: slotConfig.frameWidth, frameHeight: slotConfig.frameHeight});
            }
        });

        this.load.spritesheet("coinspin", "png/CoinSheet.png", { frameWidth: 200, frameHeight: 200});

        // 2) loading sounds
        this.load.audio('box_click_clip', ['audio/box_click.ogg', 'audio/box_click.mp3' ]);  // this.load.audio('wheel_spin_clip', 'audio/spin_sound.mp3'); this.load.audio('coins_clip', 'audio/win_coins.wav');
        this.load.audio('wincoins_clip', ['audio/mixkit_win.wav']); // this.load.audio('win_clip', ['audio/win_sound.ogg','audio/win_sound.mp3']);
        this.load.audio('button_click', ['audio/button.wav']); 
        this.load.audio('spin_clip', ['audio/spin_sound.wav']); 
        this.load.audio('win_clip', ['audio/win_coins.wav']);
        this.load.audio('lose_clip', ['audio/lose.wav']);
        this.load.audio('background_clip', ['audio/background.wav']);

        // 3) loading bitmap fonts
        slotConfig.fonts.forEach((f)=>{this.load.bitmapFont(f.fontName, f.filePNG, f.fileXML);});
    }

    // method to be executed once the scene has been created
    create(){   
        // 0) events
        this.endWinCalcEvent = new MKEvent(); 
        this.winCoinsEvent = new MKEvent();
        this.endFreeGamesEvent = new MKEvent();
        this.freeSpinWinEvent = new MKEvent();
        this.jackPotWinEvent = new MKEvent();
        this.startFreeGamesEvent = new MKEvent();

        // 1) main properties
        this.centerX = (slotGame.config.width / 2) + slotConfig.localOffsetX;
        this.centerY = (slotGame.config.height / 2) + slotConfig.localOffsetY;
        this.useWild = (slotConfig.useWild && slotConfig.hasOwnProperty('wild') && slotConfig.wild !== null);
        this.isCascadeSpin = false;         // cascade spin flag (used only in cascade slot)
        this.sumCascadeCoins = 0;           // used only in cascade slot
        this.isFreeSpin = false;            // free spin flag
        this.reelSpin = false;              // reel spin flag
        this.playFreeSpins = false;
        this.startFreeGames = false;
        this.endFreeGames = false;
        this.cTime = 0;
        this.useWildInFirstPosition = slotConfig.useWildInFirstPosition;
        this.useLineBetMultiplier = slotConfig.useLineBetMultiplier;
        this.useLineBetFreeSpinMultiplier = slotConfig.useLineBetFreeSpinMultiplier;
        this.symbolsDict = {};
        slotConfig.symbols.forEach((s)=>{if(s.fileName != null) this.symbolsDict[s.name] = s;});
        this.spinCount = 0;


        // 2) pay tables
        this.payTable = [];
        slotConfig.payLines.forEach((pLine)=>{ this.payTable.push(new PayLine(this, pLine.line, pLine.pay, pLine.freeSpins, slotConfig.wild)); });
        this.payTableFull = createFullPaytable(this.payTable, this.useWild);
        console.log('paytable full length: ' + this.payTableFull.length);  // this.payTableFull.forEach((pLine)=>{console.log(pLine);});
        this.scatterPayTable = slotConfig.scatterPayTable;

        // 3) create slot graphic
        slotConfig.createSlotGraphic(this);
        coinSpinAnim = this.anims.create({            // create coin spin animation for particles  
                        key: 'spin',
                        frames: this.anims.generateFrameNumbers('coinspin'),
                        frameRate: 16,
                        repeat: -1
                        });
        this.coinParticles = this.add.particles('coinspin').setDepth(2000); // on top of all objects


        // 4) main objects
        this.teviClient = (window.ChinaSlotTeviClient) ? window.ChinaSlotTeviClient.createFromWindow() : null;
        this.serverClient = (window.ChinaSlotServerClient) ? window.ChinaSlotServerClient.createFromWindow({ teviClient: this.teviClient }) : null;
        this.teviInitializationStatus = (this.teviClient && this.teviClient.isTeviMode()) ? "idle" : "local";
        this.slotPlayer = new SlotPlayer(this.resolveInitialPlayerCoins(slotConfig.defaultCoins));
        this.reels = slotConfig.createReels(this);
        this.lineButtons = (slotConfig.createLineButtons) ? slotConfig.createLineButtons(this) : null;  // add line buttons - optional
        this.soundController = new SoundController(this);
        this.guiController = new GuiController(this);
        this.slotControls = new SlotControls(this, this.slotPlayer, slotConfig.lines, slotConfig.lineColor, slotConfig.lineBetMaxValue, slotConfig.jackpot.defaultAmount);
        this.winController = new WinController(this, this.slotControls.linesController, slotConfig.useScatter, slotConfig.scatter, slotConfig.jackpot, slotConfig.winShowTime);
        this.backendSpinResult = null;
        this.backendSpinPlan = null;
        this.backendSpinPending = false;
        this.backendSpinStatus = (this.serverClient && this.serverClient.mode === "production") ? "idle" : "demo";
        this.topupState = "idle";
        this.topupPending = false;
        this.topupReference = null;
        this.topupModal = null;
        this.topupAmount = 0;
        this.cashoutState = "idle";
        this.cashoutPending = false;
        this.cashoutModal = null;
        this.cashoutAmount = 0;
   
        // 5) add sounds 
        this.box_click_clip = this.sound.add('box_click_clip');
        this.win_clip = this.sound.add('win_clip');
        this.button_click = this.sound.add('button_click');
        this.spin_clip = this.sound.add('spin_clip');
        this.wincoins_clip = this.sound.add('wincoins_clip');
        this.lose_clip = this.sound.add('lose_clip');
        this.background_clip = this.sound.add('background_clip');
 
        // 6) controls
        slotConfig.createControls(this, this.slotControls);
        this.slotControls.init(slotConfig.selectedLines, true);
        this.initializeTeviMiniAppShell();
        this.initializeBackendSessionBalance();
        this.initializeTeviDepositEntry();
        this.initializeTeviCashoutEntry();

        // 7) state machine
        this.stateMachine = new StateMachine();
        this.iddleState = new IddleState(this, this.stateMachine);
        this.winState = new WinState(this, this.stateMachine);
        this.loseState = new LoseState(this, this.stateMachine);
        this.spinState = new SpinState(this, this.stateMachine);
        this.preSpinState = new PreSpinState(this, this.stateMachine);
        this.freeInputWinState = new FreeInputWinState(this, this.stateMachine);
        this.stateMachine.initialize(this.iddleState);
        this.endWinCalcEvent.add((win)=>
            {
                if (win)
                {
                    this.stateMachine.changeState(this.winState);
                    this.lampsBlink(true);
                }
                else this.stateMachine.changeState(this.loseState); 
            }, this);
        
        // 8) coroutines
        this.loseCorout = null;
        this.winCorout = null;
        this.freeInputWinCorout = null;

        // 9) play background music
        this.soundController.playMusic('background_clip');

        // 10) debug
        // this.fpsText = this.add.bitmapText(this.centerX, this.centerY - 520, 'gameFont_0', 'fps: ', 40, 1).setOrigin(0.5);

        // 11) tests
        //  this.showWinCoinsMessage(20, 20000);

        /*       
         var wMess = this.guiController.showMessageYNC('CONGRATULATION!', 'YOUR WIN: ' + '20' + ' COINS!', this, 
         ()=>{this. guiController.closePopUp(wMess);}, ()=>{this. guiController.closePopUp(wMess);},()=>{this. guiController.closePopUp(wMess);},);
         */

        // var aboutPU = this.guiController.showPopUp(slotConfig.createAboutPUHandler);
        // var settingsPU = this.guiController.showPopUp(slotConfig.createSettingsPUHandler);
        // var infoPU = this.guiController.showPopUp(slotConfig.createInfoPUHandler);
        // var fgPU = this.guiController.showPopUp(slotConfig.createFreeGamesPUHandler); fgPU.messageText.text = 5;
        // var bwPU = this.guiController.showPopUp(slotConfig.createBigWinPUHandler); bwPU.messageText.text = 748;
        // var hwPU = this.guiController.showPopUp(slotConfig.createHugeWinPUHandler); hwPU.messageText.text = 748;
        // var mwPU = this.guiController.showPopUp(slotConfig.createMegaWinPUHandler); mwPU.messageText.text = 748;
        // var jpwPU = this.guiController.showPopUp(slotConfig.createJackpotWinPUHandler); jpwPU.messageText.text = 11748;
        // this.showCoins(true);
    }

    update(time, delta) // https://newdocs.phaser.io/docs/3.52.0/focus/Phaser.Scene-update
    {   
        this.cTime = time;
        simpleTweener.update(delta);
        this.updateEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, time, delta); });

        if (this.fpsText) this.fpsText.text = 'fps: ' + Math.round(slotGame.loop.actualFps);    // for debugging puposes only, can be disabled
    }

    runSlot()
    {
        if (this.isBackendProductionMode() && this.backendSpinResult === null) {
            this.requestBackendSpin();
            return;
        }

        const backendResult = this.backendSpinResult;
        const backendPlan = (this.isBackendProductionMode() && backendResult && window.ChinaSlotServerClient)
            ? window.ChinaSlotServerClient.resolveSpinRenderPlan({
                mode: "production",
                backendResult: backendResult,
                reelCount: this.reels.length
            })
            : null;
        this.backendSpinPlan = backendPlan;
        this.backendSpinResult = null;

        // 0) prepare, set flags
        let anyWin = false;
        let lineCoins = 0;          // lines win coins
        let scatterCoins = 0;       // scatter win coins
        let jpCoins = 0;            // jack pot win coins
        let winSpins = 0;
        this.isCascadeSpin = false;
        this.reelSpin = true;
        if (this.slotControls.auto && !this.isFreeSpin) this.slotControls.incAutoSpinsCounter();
        this.slotPlayer.setWinCoinsCount(0);
        this.slotControls.linesController.hideAllLines();
        if(this.loseCorout !== null) this.loseCorout.stop();
        if(this.winCorout !== null) this.winCorout.stop();
        if(this.freeInputWinCorout !== null) this.freeInputWinCorout.stop();
        this.lampsBlink(false);
        if (!backendPlan) this.slotControls.addJackpotAmount(slotConfig.jackpot.increaseValue);

        // 1) start spin sound
        this.soundController.stopSounds(); // this.soundController.stopAll(); 
        this.soundController.playClip('spin_clip', true);
        
        // 2) create spin sequence
        this.spinCount++;
        var sA = new SequencedActions();
        sA.add((callBack) =>{spinReels(this.reels, slotConfig, callBack, backendPlan ? backendPlan.reelStopPositions : null);}, this);
        sA.add((callBack) =>{
            console.log('spin complete');
            this.soundController.stopSounds(); // this.soundController.stopAll(); 
            callBack();
        }, this);

        sA.add((callBack) =>{
            this.winController.searchWinSymbols();
            callBack();
            }, this);  // search spin result

        sA.add((callBack) =>{
            anyWin = backendPlan ? backendPlan.payout > 0 || backendPlan.freeSpinState.awarded > 0 || backendPlan.jackpotState.awarded > 0 : this.winController.hasAnyWinn(); 
            if(anyWin)
            {
                lineCoins = backendPlan ? backendPlan.payout : this.winController.getLineWinCoins();
                scatterCoins = backendPlan ? 0 : this.winController.getScatterWinCoins();
                jpCoins = backendPlan ? backendPlan.jackpotState.awarded : this.winController.getJackpotWinCoins();
                if(jpCoins > 0) this.jackPotWinEvent.events.forEach((eW)=>{if (eW != null && eW.action != null) eW.action.call(eW.context, jpCoins);}); 

                if (!backendPlan && this.useLineBetMultiplier) 
                {
                    lineCoins *= this.slotControls.lineBet;
                    scatterCoins *= this.slotControls.lineBet; 
                }
                var summCoins = jpCoins + lineCoins + scatterCoins;
                if (summCoins > 0) this.winCoinsEvent.events.forEach((eW)=>{if (eW != null && eW.action != null) eW.action.call(eW.context, summCoins);}); 

                winSpins = backendPlan ? backendPlan.freeSpinState.awarded : this.winController.getWinSpins();
                if (!backendPlan && this.useLineBetFreeSpinMultiplier) winSpins *= this.slotControls.lineBet;
                if (winSpins > 0) this.freeSpinWinEvent.events.forEach((eW)=>{if (eW != null && eW.action != null) eW.action.call(eW.context, winSpins);}); 
            }
            else
            {
                this.isCascadeSpin = false;
            }
            if (backendPlan) this.applyBackendSpinPlanDisplay(backendPlan);
            this.endWinCalcEvent.events.forEach((eW)=>{if (eW != null && eW.action != null) eW.action.call(eW.context, anyWin);});   // start win show or loose show
            callBack();
        }, this);

        sA.add((callBack) =>{callBack();}, this);

        sA.start();
    }

    isBackendProductionMode()
    {
        return this.serverClient !== null && this.serverClient.mode === "production";
    }

    resolveInitialPlayerCoins(defaultCoins)
    {
        if (this.isBackendProductionMode()) return 0;
        if (this.teviClient && this.teviClient.isTeviMode && this.teviClient.isTeviMode()) return 0;
        return defaultCoins;
    }

    isTeviSessionMode()
    {
        return !!(this.teviClient && this.teviClient.isTeviMode && this.teviClient.isTeviMode());
    }

    initializeTeviMiniAppShell()
    {
        if (!this.isTeviSessionMode()) return null;

        this.teviInitializationStatus = "pending";
        // Expose the init promise so the session/balance load can wait for the Tevi SDK to
        // finish loading before it calls getUserAppToken() (defect 8.12 SDK-init race).
        this.teviReady = this.teviClient.initialize().then((result) => {
            this.teviInitializationStatus = result && result.available ? "ready" : "unavailable";
            return result;
        }).catch((_error) => {
            this.teviInitializationStatus = "unavailable";
            return null;
        });
        return this.teviReady;
    }

    initializeBackendSessionBalance()
    {
        if (!this.isBackendProductionMode()) return;

        if (this.slotControls && this.slotControls.creditSumText != null) {
            this.slotControls.creditSumText.text = ' ...';
        }
        this.backendSpinStatus = "pending";

        // Tevi sessions need a live SDK (getUserAppToken) — wait for teviClient.initialize()
        // to resolve before the first attempt, otherwise the call races the SDK script load
        // and fails as sdk-unavailable. Local/demo generic sessions (/api/sessions) have no
        // such dependency and load immediately, so behavior there is unchanged (AC3).
        if (this.isTeviSessionMode() && this.teviReady && typeof this.teviReady.then === "function") {
            this.teviReady.then(() => this.loadBackendSessionBalance(0));
        } else {
            this.loadBackendSessionBalance(0);
        }
    }

    // Terminal failures that never recover on retry, so the user must re-auth instead of
    // watching pointless retries:
    //   - HTTP 401 from the session / token-exchange endpoint: the provider rejected the
    //     runtime token (PROVIDER_REJECTED) or the access token failed verification. Retrying
    //     re-sends the same rejected token. Provider outages surface as 5xx (502/503) and stay
    //     retryable — that is why we key on the 401 status, not the TEVI_TOKEN_EXCHANGE_FAILED
    //     code (which the backend also returns for transient 502/503 cases).
    //   - TEVI_REAUTH_REQUIRED with a genuine not-authenticated reason (token-missing /
    //     user-cancelled / re-authentication-required) or a permanently-broken integration
    //     (method-unavailable / sdk-call-failed). Transient SDK-not-ready reasons
    //     (sdk-unavailable / sdk-timeout) and network blips stay retryable.
    isTerminalSessionReauth(error)
    {
        if (!error) return false;
        if (error.status === 401) return true;
        if (error.code !== "TEVI_REAUTH_REQUIRED") return false;
        var terminalReasons = ["token-missing", "user-cancelled", "re-authentication-required", "method-unavailable", "sdk-call-failed"];
        return terminalReasons.indexOf(error.reason) !== -1;
    }

    scheduleSceneDelay(ms, callback)
    {
        if (this.time && typeof this.time.delayedCall === "function") {
            this.time.delayedCall(ms, callback);
            return;
        }
        setTimeout(callback, ms);
    }

    loadBackendSessionBalance(attempt)
    {
        var maxAttempts = 3;   // initial + 2 retries for slow/late SDK readiness (AC2)
        this.backendSpinStatus = "pending";

        this.serverClient.startSession().then((session) => {
            var points = (session && session.balance) ? Number(session.balance.points) : NaN;
            if (!Number.isFinite(points)) {
                throw new Error("Session balance is invalid.");
            }
            this.slotPlayer.setCoinsCount(points);
            // Force the HUD to render even when the balance equals the initial 0 coins
            // (setCoinsCount skips its change event when the value is unchanged), so the
            // ' ...' placeholder is always replaced once the session resolves.
            if (this.slotControls && typeof this.slotControls.changeCreditCoinsHandler === "function") {
                this.slotControls.changeCreditCoinsHandler(points);
            }
            if (typeof this.updateCashoutEntryEnabled === "function") {
                this.updateCashoutEntryEnabled();
            }
            this.backendSpinStatus = "ready";
        }).catch((error) => {
            if (!this.isTerminalSessionReauth(error) && attempt + 1 < maxAttempts) {
                // Transient (SDK loaded late / network blip) — retry with a short backoff.
                var delay = 600 * (attempt + 1);
                this.scheduleSceneDelay(delay, () => this.loadBackendSessionBalance(attempt + 1));
                return;
            }
            this.surfaceSessionBalanceFailure(error);
        });
    }

    // A failed balance load must never leave the HUD silently stuck on ' ...' (AC2).
    surfaceSessionBalanceFailure(error)
    {
        var terminalReauth = this.isTerminalSessionReauth(error);
        this.backendSpinStatus = terminalReauth ? "reauth-required" : "retry";
        this.backendSpinPlan = window.ChinaSlotServerClient ? window.ChinaSlotServerClient.buildRetryState(error) : null;

        if (this.slotControls && this.slotControls.creditSumText != null) {
            this.slotControls.creditSumText.text = ' —';
        }

        if (this.guiController && this.guiController.showMessage) {
            var title = terminalReauth ? "Sign in to Tevi" : "Backend unavailable";
            var body = terminalReauth
                ? "Sign in to Tevi again to load your Stars balance."
                : "Could not load your balance. Reopen the game to try again.";
            var message = this.guiController.showMessage(title, body, this, () => {
                this.guiController.closePopUp(message);
            });
        }
    }

    createClientSpinId()
    {
        return "client-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }

    createBackendWager()
    {
        var selectedWays = (slotConfig.waysPolicy && slotConfig.waysPolicy.totalWays) || slotConfig.selectedWays || 243;
        var lineBet = this.slotControls.lineBet;

        return {
            lineBet: lineBet,
            selectedWays: selectedWays,
            totalWager: lineBet * selectedWays
        };
    }

    requestBackendSpin()
    {
        if (this.backendSpinPending) return;

        this.backendSpinPending = true;
        this.backendSpinStatus = "pending";
        this.slotControls.setSpinButtonText("WAIT");
        this.slotControls.setControlActivity(false, false, false);

        this.serverClient.spin({
            clientSpinId: this.createClientSpinId(),
            wager: this.createBackendWager()
        }).then((result) => {
            if (result && result.retryable) {
                this.handleBackendSpinRetry(result);
                return;
            }

            this.backendSpinResult = result;
            this.backendSpinPending = false;
            this.backendSpinStatus = "ready";
            this.runSlot();
        }).catch((error) => {
            var retryState = window.ChinaSlotServerClient ? window.ChinaSlotServerClient.buildRetryState(error) : {
                status: "retry",
                retryable: true,
                message: "Reward-bearing play is paused while the backend is unavailable."
            };
            this.handleBackendSpinRetry(retryState);
        });
    }

    handleBackendSpinRetry(retryState)
    {
        this.backendSpinResult = null;
        this.backendSpinPending = false;
        this.backendSpinStatus = "retry";
        this.backendSpinPlan = retryState;
        this.slotControls.setSpinButtonText("RETRY");
        this.slotControls.setControlActivity(true, true, true);
        if (this.slotControls.auto) this.slotControls.resetAutoSpinsMode();
        if (this.guiController && this.guiController.showMessage) {
            var message = this.guiController.showMessage("Backend unavailable", retryState.message, this, () => {
                this.guiController.closePopUp(message);
            });
        }
        this.stateMachine.changeState(this.iddleState);
    }

    applyBackendSpinPlanDisplay(backendPlan)
    {
        this.slotPlayer.setWinCoinsCount(backendPlan.payout);
        this.slotPlayer.setCoinsCount(backendPlan.balanceAfter);
        this.slotControls.setFreeSpinsCount(backendPlan.freeSpinState.remaining);
        this.slotControls.setJackpotAmount(backendPlan.jackpotState.awarded);
    }

    // ----- Tevi Star top-up (Story 8.5): SDK initiation + pending state only -----
    // This flow never mutates the authoritative wallet balance. Crediting happens
    // only after Story 8.6 verifies the Tevi webhook and updates backend state.

    isTopupAvailable()
    {
        return !!(this.teviClient && this.teviClient.isTeviMode && this.teviClient.isTeviMode()
            && this.serverClient && typeof this.serverClient.requestTopupSignature === "function"
            && this.teviClient.topup);
    }

    createTopupAttemptId()
    {
        return "topup-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }

    resolveTopupMaxStars()
    {
        var teviConfig = (typeof window !== "undefined" && window.CHINA_SLOT_TEVI_CONFIG) || {};
        var topupConfig = teviConfig.topup || {};
        var max = Number(topupConfig.maxStars);
        return isFinite(max) && max > 0 ? max : 100000;
    }

    isValidTopupAmount(amount)
    {
        return typeof amount === "number" && isFinite(amount) && Math.floor(amount) === amount
            && amount > 0 && amount <= this.resolveTopupMaxStars();
    }

    submitTopup(amount)
    {
        if (!this.isTopupAvailable()) return null;     // local/demo mode: no value-bearing top-up
        if (this.topupPending) return null;            // debounce duplicate CTA taps
        if (!this.isValidTopupAmount(amount)) {
            this.setTopupState("invalid-amount");
            return null;
        }

        this.topupPending = true;
        var attemptId;
        try {
            // Guard the synchronous prelude so a render/clock error can never strand topupPending.
            this.topupReference = null;
            this.setTopupState("preparing");
            attemptId = this.createTopupAttemptId();
        } catch (_error) {
            this.topupPending = false;
            this.setTopupState("retryable-failure");
            return null;
        }

        return this.serverClient.requestTopupSignature(amount).then((signature) => {
            if (!signature || !signature.ok) {
                this.finishTopup(signature && signature.status ? signature.status : "retryable-failure");
                return null;
            }

            this.setTopupState("sdk-confirmation-open");

            // The deposit token is passed straight to the SDK and never stored on the scene.
            return this.teviClient.topup({
                amount: amount,
                depositToken: signature.depositToken,
                requestId: signature.requestId,
                attemptId: attemptId
            }).then((result) => {
                this.handleTopupResult(result);
                return result;
            });
        }).catch(() => {
            this.finishTopup("retryable-failure");
            return null;
        });
    }

    handleTopupResult(result)
    {
        var status = result && result.status ? result.status : "failed";
        this.topupPending = false;
        if (status === "webhook-pending") {
            this.topupReference = (result && result.reference) || null;
            // Crediting stays server-authoritative — we never add Stars to the wallet here.
            // Instead poll the server for the webhook-applied credit so the HUD + dialog
            // reflect it without a manual spin or full reload (AC4).
            this.setTopupState("webhook-pending");
            this.startPostDepositBalanceRefresh();
            return;
        }
        this.finishTopup(status);
    }

    // Poll the authoritative server balance after a pending deposit until the credited
    // Stars land (balance increases) or we hit the bounded attempt limit. Read-only.
    startPostDepositBalanceRefresh()
    {
        if (!this.serverClient || typeof this.serverClient.refreshSession !== "function") return;
        // New token => a fresh poll cycle; lets a later deposit supersede an earlier one.
        this.balanceRefreshToken = (this.balanceRefreshToken || 0) + 1;
        var token = this.balanceRefreshToken;

        // Capture the baseline synchronously from the last server-confirmed client value.
        // slotPlayer.coins is always server-sourced (we never mutate it client-side), so it
        // reflects the pre-deposit balance. The Tevi SDK only resolves its topup promise
        // AFTER the payment is confirmed, which means the webhook may already have credited
        // the wallet by the time we get here. Using a refreshSession() call for the baseline
        // would race with that webhook: if it wins, baseline = post-credit and the poll
        // condition (points > baseline) can never fire (8.12 race fix).
        var syncBaseline = this.slotPlayer ? Number(this.slotPlayer.coins) : NaN;
        if (Number.isFinite(syncBaseline)) {
            this.pollPostDepositBalance(0, syncBaseline, token);
            return;
        }

        // Fallback: balance not yet loaded on the client — do a server read for the baseline.
        this.serverClient.refreshSession().then((session) => {
            if (token !== this.balanceRefreshToken) return;
            var baseline = (session && session.balance) ? Number(session.balance.points) : NaN;
            this.pollPostDepositBalance(0, baseline, token);
        }).catch(() => {
            if (token !== this.balanceRefreshToken) return;
            this.pollPostDepositBalance(0, NaN, token);
        });
    }

    pollPostDepositBalance(attempt, baseline, token)
    {
        var maxAttempts = 8;        // bounded: ~ maxAttempts * intervalMs of polling
        var intervalMs = 2000;
        if (token !== this.balanceRefreshToken) return;   // superseded by a newer deposit

        this.serverClient.refreshSession().then((session) => {
            if (token !== this.balanceRefreshToken) return;
            var points = (session && session.balance) ? Number(session.balance.points) : NaN;

            // Confirm only on a real increase over the server-established baseline. Without a
            // finite baseline we cannot distinguish a credit, so keep polling rather than
            // accepting the current balance as "credited".
            if (Number.isFinite(points) && Number.isFinite(baseline) && points > baseline) {
                this.slotPlayer.setCoinsCount(points);
                if (this.slotControls && typeof this.slotControls.changeCreditCoinsHandler === "function") {
                    this.slotControls.changeCreditCoinsHandler(points);
                }
                this.backendSpinStatus = "ready";
                if (this.topupState === "webhook-pending") {
                    this.setTopupState("credited");
                    this.scheduleDepositModalClose();
                }
                return;
            }

            if (attempt + 1 < maxAttempts) {
                this.scheduleSceneDelay(intervalMs, () => this.pollPostDepositBalance(attempt + 1, baseline, token));
            }
            // Timeout leaves the dialog on its informative webhook-pending message; the
            // credit will still appear on the next session load / spin.
        }).catch(() => {
            if (token !== this.balanceRefreshToken) return;
            if (attempt + 1 < maxAttempts) {
                this.scheduleSceneDelay(intervalMs, () => this.pollPostDepositBalance(attempt + 1, baseline, token));
            }
        });
    }

    finishTopup(status)
    {
        this.topupPending = false;
        this.setTopupState(status || "failed");
    }

    setTopupState(state)
    {
        this.topupState = state;
        this.renderTopupStatus();
    }

    topupStatusMessage(status)
    {
        switch (status) {
            case "idle":
                return "Ready to deposit Stars.";
            case "preparing":
                return "Preparing Tevi deposit.";
            case "sdk-confirmation-open":
                return "Waiting for Tevi confirmation.";
            case "invalid-amount":
                return "Enter a whole number of Stars to deposit.";
            case "webhook-pending":
                return this.topupReference
                    ? "Waiting for Tevi confirmation. Reference " + this.topupReference + "."
                    : "Waiting for Tevi confirmation.";
            case "credited":
                return "Deposit confirmed. Your Stars balance is updated.";
            case "canceled":
                return "Deposit canceled.";
            case "re-authentication-required":
                return "Sign in to Tevi again to deposit Stars.";
            case "blocked":
                return "Tevi deposit is unavailable right now.";
            case "retryable-failure":
                return "Tevi deposit did not complete. Tap Deposit to try again.";
            default:
                return "Tevi deposit could not be completed.";
        }
    }

    resolveTopupPresets()
    {
        var defaults = [50, 100, 250, 500];
        var teviConfig = (typeof window !== "undefined" && window.CHINA_SLOT_TEVI_CONFIG) || {};
        var topupConfig = teviConfig.topup || {};
        if (Array.isArray(topupConfig.presets)) {
            var valid = topupConfig.presets.filter((value) => this.isValidTopupAmount(value));
            if (valid.length > 0) return valid;   // fall back to defaults when all configured presets are invalid
        }
        return defaults;
    }

    // ----- Tevi Star cashout (Story 8.8): backend debit + provider dispatch -----

    isCashoutAvailable()
    {
        return !!(this.teviClient && this.teviClient.isTeviMode && this.teviClient.isTeviMode()
            && this.serverClient && typeof this.serverClient.requestCashout === "function");
    }

    resolveWithdrawableBalance()
    {
        return Number(this.slotPlayer && this.slotPlayer.coins) || 0;
    }

    resolveCashoutFeePercent()
    {
        var teviConfig = (typeof window !== "undefined" && window.CHINA_SLOT_TEVI_CONFIG) || {};
        var cashoutConfig = teviConfig.cashout || {};
        var fee = Number(cashoutConfig.feePercent);
        return isFinite(fee) && fee >= 0 && fee <= 100 ? fee : 1;
    }

    calculateCashoutReceive(amount)
    {
        if (!this.isValidCashoutAmount(amount)) return null;
        var feePercent = this.resolveCashoutFeePercent();
        return Math.floor(amount * (100 - feePercent) / 100);
    }

    isValidCashoutAmount(amount)
    {
        var withdrawable = this.resolveWithdrawableBalance();
        return typeof amount === "number" && isFinite(amount) && Math.floor(amount) === amount
            && amount > 0 && amount <= withdrawable;
    }

    resolveCashoutPresets()
    {
        var defaults = [100, 200, 500, 1000, 2000];
        var withdrawable = this.resolveWithdrawableBalance();
        var teviConfig = (typeof window !== "undefined" && window.CHINA_SLOT_TEVI_CONFIG) || {};
        var cashoutConfig = teviConfig.cashout || {};
        if (Array.isArray(cashoutConfig.presets)) {
            var valid = cashoutConfig.presets.filter((value) => this.isValidCashoutAmount(value));
            if (valid.length > 0) return valid;
        }
        return defaults.filter((value) => value <= withdrawable);
    }

    initializeTeviCashoutEntry()
    {
        if (!this.isCashoutAvailable()) return null;
        if (typeof SceneButton === "undefined") return null;

        var layout = (slotConfig.layout && slotConfig.layout.controls && slotConfig.layout.controls.cashout)
            || { x: -540, y: -420, scale: 1 };
        var scale = layout.scale != null ? layout.scale : 1;

        this.cashoutButton = new SceneButton(this, 'panel_totalbet', 'panel_totalbet', false);
        this.cashoutButton.create(layout.x, layout.y, 0.5, 0.5);
        this.cashoutButton.button.setScale(scale);
        this.cashoutButton.setDepth(15);
        this.cashoutButton.addClickEvent(() => { this.openCashoutModal(); }, this);

        this.cashoutButtonText = this.add.bitmapText(this.cashoutButton.posX, this.cashoutButton.posY - 2, 'gameFont_1', 'CASH OUT', 32, 1).setOrigin(0.5);
        this.cashoutButtonText.setScale(scale);
        this.cashoutButtonText.tint = 0xFFFFFF;
        this.cashoutButtonText.depth = 16;
        this.slotPlayer.addChangeCoinsEvent(this.updateCashoutEntryEnabled, this);
        this.updateCashoutEntryEnabled();
        return this.cashoutButton;
    }

    updateCashoutEntryEnabled()
    {
        if (!this.cashoutButton) return;
        var enabled = this.resolveWithdrawableBalance() > 0 && !this.cashoutPending;
        this.cashoutButton.setInteractable(enabled);
        if (this.cashoutButton.button) this.cashoutButton.button.alpha = enabled ? 1 : 0.5;
    }

    openCashoutModal()
    {
        if (!this.isCashoutAvailable()) return null;
        if (this.cashoutModal) return this.cashoutModal;
        if (!this.guiController || !this.guiController.showPopUp) return null;
        if (typeof createCashoutPUHandler === "undefined") return null;

        var presets = this.resolveCashoutPresets();
        this.cashoutAmount = presets.length > 0 ? presets[0] : 0;
        this.cashoutStep = presets.length > 0 ? presets[0] : 100;
        this.setCashoutState("idle");

        var modal = this.guiController.showPopUp(createCashoutPUHandler);
        this.cashoutModal = modal;

        modal.minusButton.addClickEvent(() => { this.adjustCashoutAmount(-this.cashoutStep); }, this);
        modal.plusButton.addClickEvent(() => { this.adjustCashoutAmount(this.cashoutStep); }, this);
        modal.okButton.addClickEvent(() => { this.submitCashout(this.cashoutAmount); }, this);
        modal.exitButton.addClickEvent(() => { this.closeCashoutModal(); }, this);

        this.renderCashoutModalAmount();
        this.renderCashoutStatus();
        return modal;
    }

    closeCashoutModal()
    {
        if (this.cashoutModal && this.guiController) {
            this.guiController.closePopUp(this.cashoutModal);
        }
        this.cashoutModal = null;
    }

    mapCashoutApiStatus(apiStatus)
    {
        if (apiStatus === "dispatched") return "dispatched";
        if (apiStatus === "failed_retryable") return "failed-retryable";
        return null;
    }

    isCommittedCashoutApiStatus(apiStatus)
    {
        return apiStatus === "dispatched" || apiStatus === "failed_retryable";
    }

    // Tevi debits the game wallet on API commit (dispatched / failed_retryable). user_withdraw webhooks
    // reconcile provider payout later without mutating the wallet again (playbook §5).
    finishCommittedCashout(apiStatus)
    {
        if (!this.mapCashoutApiStatus(apiStatus)) return;
        this.closeCashoutModal();
        this.setCashoutState("idle");
    }

    handleCashoutResult(result)
    {
        this.cashoutPending = false;
        if (!result || !result.ok) {
            this.setCashoutState(result && result.status ? result.status : "retryable-failure");
            return;
        }

        if (result.balanceAfter != null && this.slotPlayer) {
            this.slotPlayer.setCoinsCount(result.balanceAfter);
        }
        this.updateCashoutEntryEnabled();

        if (this.isCommittedCashoutApiStatus(result.cashoutStatus)) {
            this.finishCommittedCashout(result.cashoutStatus);
            return;
        }

        this.setCashoutState("retryable-failure");
    }

    adjustCashoutAmount(delta)
    {
        if (this.cashoutPending) return;
        var next = (Number(this.cashoutAmount) || 0) + delta;
        var max = this.resolveWithdrawableBalance();
        if (next < 0) next = 0;
        if (next > max) next = max;
        this.cashoutAmount = next;
        this.renderCashoutModalAmount();
        this.updateCashoutConfirmEnabled();
    }

    renderCashoutModalAmount()
    {
        if (!this.cashoutModal) return;
        if (this.cashoutModal.amountText) {
            this.cashoutModal.amountText.text = String(this.cashoutAmount || 0) + " ★";
        }
        if (this.cashoutModal.receiveText) {
            var receive = this.calculateCashoutReceive(this.cashoutAmount);
            this.cashoutModal.receiveText.text = receive == null
                ? "Receive: —"
                : "Receive: " + receive + " ★";
        }
    }

    renderCashoutStatus()
    {
        if (this.cashoutModal && this.cashoutModal.messageText) {
            this.cashoutModal.messageText.text = this.cashoutStatusMessage(this.cashoutState);
        }
        this.updateCashoutConfirmEnabled();
    }

    updateCashoutConfirmEnabled()
    {
        if (!this.cashoutModal || !this.cashoutModal.okButton) return;
        var enabled = !this.cashoutPending && this.isValidCashoutAmount(this.cashoutAmount);
        this.cashoutModal.okButton.setInteractable(enabled);
        if (this.cashoutModal.okButton.button) this.cashoutModal.okButton.button.alpha = enabled ? 1 : 0.5;
    }

    submitCashout(amount)
    {
        if (!this.isCashoutAvailable()) return null;
        if (this.cashoutPending) return null;
        if (!this.isValidCashoutAmount(amount)) {
            this.setCashoutState("invalid-amount");
            return null;
        }

        this.cashoutPending = true;
        try {
            this.setCashoutState("preparing");
        } catch (_error) {
            this.cashoutPending = false;
            this.setCashoutState("retryable-failure");
            return null;
        }

        return this.serverClient.requestCashout(amount).then((result) => {
            this.handleCashoutResult(result);
            return result;
        }).catch(() => {
            this.cashoutPending = false;
            this.setCashoutState("retryable-failure");
            return null;
        });
    }

    setCashoutState(state)
    {
        this.cashoutState = state;
        this.renderCashoutStatus();
        this.updateCashoutEntryEnabled();
    }

    cashoutStatusMessage(status)
    {
        switch (status) {
            case "idle":
                return "1% withdrawal fee applies.";
            case "preparing":
                return "Submitting cash out request.";
            case "invalid-amount":
                return "This amount is higher than your available Stars.";
            case "insufficient-balance":
                return "This amount is higher than your available Stars.";
            case "dispatched":
                return "Cash out request received.";
            case "failed-retryable":
                return "Your Stars balance is updated. Payout is being processed on Tevi.";
            case "re-authentication-required":
                return "Sign in to Tevi again to cash out Stars.";
            case "blocked":
                return "Cash out is unavailable right now.";
            case "retryable-failure":
                return "Cash out did not complete. Tap Cash Out to try again.";
            default:
                return "Cash out could not be completed.";
        }
    }

    // Phaser deposit entry button, shown only inside an explicit Tevi sandbox session.
    // Reuses the existing popup button asset; opens the in-game deposit modal on click.
    // Position comes from the active layout (slotConfig.layout.controls.deposit) so it stays
    // on-screen in both portrait and landscape.
    initializeTeviDepositEntry()
    {
        if (!this.isTopupAvailable()) return null;
        if (typeof SceneButton === "undefined") return null;

        var layout = (slotConfig.layout && slotConfig.layout.controls && slotConfig.layout.controls.deposit)
            || { x: -740, y: -420, scale: 1 };
        var scale = layout.scale != null ? layout.scale : 1;

        // Use the same panel sprite + scale as the TOTAL BET control so the deposit CTA matches its size.
        this.depositButton = new SceneButton(this, 'panel_totalbet', 'panel_totalbet', false);
        this.depositButton.create(layout.x, layout.y, 0.5, 0.5);
        this.depositButton.button.setScale(scale);
        this.depositButton.setDepth(15);
        this.depositButton.addClickEvent(() => { this.openDepositModal(); }, this);

        // Label centered on the panel, scaled with it so text and background stay aligned,
        // sized below the panel width to leave padding around the text.
        this.depositButtonText = this.add.bitmapText(this.depositButton.posX, this.depositButton.posY - 2, 'gameFont_1', 'DEPOSIT', 38, 1).setOrigin(0.5);
        this.depositButtonText.setScale(scale);
        this.depositButtonText.tint = 0xFFFFFF;
        this.depositButtonText.depth = 16;
        return this.depositButton;
    }

    openDepositModal()
    {
        if (!this.isTopupAvailable()) return null;
        if (this.topupModal) return this.topupModal;   // already open
        if (!this.guiController || !this.guiController.showPopUp) return null;
        if (typeof createTopupPUHandler === "undefined") return null;

        var presets = this.resolveTopupPresets();
        this.topupAmount = presets.length > 0 ? presets[0] : 0;
        this.topupStep = presets.length > 0 ? presets[0] : 50;   // stepper increment mirrors the smallest preset
        if (this.topupState !== "webhook-pending") this.setTopupState("idle");

        var modal = this.guiController.showPopUp(createTopupPUHandler);
        this.topupModal = modal;

        modal.minusButton.addClickEvent(() => { this.adjustTopupAmount(-this.topupStep); }, this);
        modal.plusButton.addClickEvent(() => { this.adjustTopupAmount(this.topupStep); }, this);
        modal.okButton.addClickEvent(() => { this.submitTopup(this.topupAmount); }, this);
        modal.exitButton.addClickEvent(() => { this.closeDepositModal(); }, this);

        this.renderTopupModalAmount();
        this.renderTopupStatus();
        return modal;
    }

    closeDepositModal()
    {
        this.depositModalCloseToken = (this.depositModalCloseToken || 0) + 1;
        if (this.topupModal && this.guiController) {
            this.guiController.closePopUp(this.topupModal);
        }
        this.topupModal = null;
    }

    // Brief success message, then dismiss the deposit modal so the player can spin again.
    scheduleDepositModalClose(delayMs)
    {
        if (!this.topupModal) return;
        var delay = Number.isFinite(delayMs) ? delayMs : 1500;
        this.depositModalCloseToken = (this.depositModalCloseToken || 0) + 1;
        var token = this.depositModalCloseToken;
        this.scheduleSceneDelay(delay, () => {
            if (token !== this.depositModalCloseToken) return;
            if (!this.topupModal || this.topupState !== "credited") return;
            this.closeDepositModal();
            this.setTopupState("idle");
        });
    }

    adjustTopupAmount(delta)
    {
        if (this.topupPending) return;     // amount is locked while a deposit is in flight
        var next = (Number(this.topupAmount) || 0) + delta;
        var max = this.resolveTopupMaxStars();
        if (next < 0) next = 0;
        if (next > max) next = max;
        this.topupAmount = next;
        this.renderTopupModalAmount();
        this.updateTopupConfirmEnabled();
    }

    renderTopupModalAmount()
    {
        if (this.topupModal && this.topupModal.amountText) {
            this.topupModal.amountText.text = String(this.topupAmount || 0) + " ★";
        }
    }

    renderTopupStatus()
    {
        if (this.topupModal && this.topupModal.messageText) {
            this.topupModal.messageText.text = this.topupStatusMessage(this.topupState);
        }
        this.updateTopupConfirmEnabled();
    }

    updateTopupConfirmEnabled()
    {
        if (!this.topupModal || !this.topupModal.okButton) return;
        var enabled = !this.topupPending && this.isValidTopupAmount(this.topupAmount);
        this.topupModal.okButton.setInteractable(enabled);
        if (this.topupModal.okButton.button) this.topupModal.okButton.button.alpha = enabled ? 1 : 0.5;
    }

    // add sprite relative to scene center
    addSpriteLocPos(name, posX, posY)
    {
        return  this.add.sprite(this.centerX + posX, this.centerY + posY, name);
    } 

    // wait miliseconds coroutine
    *wait_ms(ms) 
    {
        var timeTarget = this.cTime + ms;
        while (timeTarget > this.cTime)
        {
          //  console.log('wait_ms: ' + (-this.cTime + timeTarget));
            yield (timeTarget - this.cTime);
        }
    }

    // start win show coroutine
    winShow(completeCallBack)
    {
        this.miniGame = null;
        this.winCorout = new Coroutiner(this, this.winShowC(completeCallBack));
        this.winCorout.start();
    }

    // win show coroutine
    *winShowC(completeCallBack)
    {
        console.log("win show start: " + this.spinCount);
        //3a ------ any win show event -------
        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            console.log("wait: this.miniGame and popups:  " + this.miniGame  + " : " + this.guiController.hasNoPopUp());
            yield null;
        }

        // 3b0 ---- show particles, line flashing  -----------
        let winShowEnd = false;
        this.winController.winSymbolShowOnce(()=>{ winShowEnd = true; });

        yield* this.wait_ms(1000);

        //3b1 --------- check Jack pot -------------
        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            yield null;
        }

        //3c0 -----------------calc coins -------------------
        let backendPlan = this.backendSpinPlan;
        let jpCoins = backendPlan ? backendPlan.jackpotState.awarded : this.winController.getJackpotWinCoins();
        let winCoins = backendPlan ? backendPlan.payout : this.winController.getLineWinCoins() + this.winController.getScatterWinCoins();
        if (!backendPlan && this.useLineBetMultiplier) winCoins *= this.slotControls.lineBet;
        this.slotPlayer.setWinCoinsCount(winCoins + jpCoins);
        if (backendPlan) this.applyBackendSpinPlanDisplay(backendPlan);
        else this.slotPlayer.addCoins(winCoins + jpCoins);
       
        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            yield null;
        }

        console.log('jackpot win : ' + jpCoins);
        if(jpCoins > 0)
        {      
            this.showJackpotWinMessage(jpCoins, slotConfig.winMessageTime * 2);
            this.soundController.playClip('wincoins_clip', false);    
            this.slotControls.resetJackpot();     
        }

        //3c1 ----------- calc free spins ----------------
        let winSpins = backendPlan ? backendPlan.freeSpinState.awarded : this.winController.getWinSpins();
        let winLinesCount = this.winController.winLines.length;
        if (!backendPlan && this.useLineBetFreeSpinMultiplier) winSpins *= this.slotControls.lineBet;

        // win coins, big win, win spins sounds and messages
        let bigWin = (winCoins > 0 && winCoins >= this.slotPlayer.minWin && this.slotPlayer.useBigWinCongratulation);
        if(bigWin)
        { 
            console.log('big win congratulation : ' + winCoins);
            this.showBigWinMessage(winCoins, slotConfig.winMessageTime * 2);
            this.soundController.playClip('wincoins_clip', false);         
        }
        else if(winCoins > 0 )
        { 
            console.log('win coins congratulation : ' + winCoins);
            if(slotConfig.showWinCoinsMessage) this.showWinCoinsMessage(winCoins, slotConfig.winMessageTime);
            this.soundController.playClip('wincoins_clip', false);
        }

        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            yield null;
        }

        if (winSpins > 0) 
        {
            if(winCoins > 0) yield* this.wait_ms(1000);   // delay between messages
            console.log('win free spins congratulation : ' + winSpins);
            this.showWinFreeSpinsMessage(winSpins, slotConfig.winMessageTime);
            setTimeout(()=>
            { 
                this.soundController.playClip('win_clip', false);
            }, winCoins > 0 ? 1500 : 100);
            
        }
        if (backendPlan) this.applyBackendSpinPlanDisplay(backendPlan);
        else this.slotControls.addFreeSpins(winSpins);
        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            yield null;
        }

        this.playFreeSpins = (this.slotControls.autoPlayFreeSpins && this.slotControls.hasFreeSpin());
        this.startFreeGames = !this.isFreeSpin && this.playFreeSpins;
        this.endFreeGames = this.isFreeSpin && !this.playFreeSpins;
        if (this.endFreeGames) this.endFreeGamesEvent.invoke();
        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            yield null;
        }

        //3d0 ----- invoke scatter win event -----------
        if (this.winController.scatterWin != null && this.winController.scatterWin.winEvent != null) 
        {
            yield* this.wait_ms(1000);
            this.winController.scatterWin.winEvent.invoke();
            while(this.miniGame !== null || !this.guiController.hasNoPopUp())
            {
                yield null;
            }
        }

        // 3d1 -------- add levelprogress --------------
        this.slotPlayer.addLevelProgress((this.useLineBetProgressMultiplier) ? this.winSpinLevelProgress * winLinesCount * this.slotControls.lineBet : this.winSpinLevelProgress * winLinesCount); // for each win line
        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            yield null;
        }

        // 3d2 ------------ start line events ----------
      //  this.winController.startLineEvents();
        while(this.miniGame !== null || !this.guiController.hasNoPopUp())
        {
            yield null;
        }
       
        // start free games events
        if (this.startFreeGames) 
        {
            // var fgPU = this.guiController.showMessage("START FREE GAME", winSpins, this, () => { this.guiController.closePopUp(fgPU);});    
            var fgPU = this.guiController.showPopUp(slotConfig.createFreeGamesPUHandler);
            fgPU.messageText.text = winSpins;

            this.startFreeGamesEvent.invoke();
            while(this.miniGame !== null || !this.guiController.hasNoPopUp())
            {
                yield null;
            }
        }

        //3e ---- ENABLE player interaction -----------
        this.reelsSpin = false;
      //  this.soundController.playMusic('');
        
        /*
        if (this.slotControls.auto && this.slotControls.autoSpinsCounter >= slotConfig.maxAutoSpins)
        {
            this.slotControls.resetAutoSpinsMode();
        }
        */
        while(!winShowEnd)
        {
            yield null;
        }

        //if (logStatistic) SlotStatistic.PrintStatistic();
        completeCallBack();
        console.log('win show end: ' + this.spinCount);
    }

    // start win show coroutine while waiting for player action
    freeInputWinShow (completeCallBack)
    {
        this.freeInputWinCorout = new Coroutiner(this, this.freeInputWinShowC(completeCallBack));
        this.freeInputWinCorout.start();
    }

    // win show coroutine while waiting for player action
    *freeInputWinShowC (completeCallBack)
    {
        yield* this.wait_ms(1000);
        let winShowEnd = false;
        this.winController.winSymbolShowOnce(()=>{ winShowEnd  = true; });

        while (!winShowEnd )
        {
          //  console.log('wait win symbols show');
            yield null;
        }
        completeCallBack(this.slotControls.auto || this.playFreeSpins);
    }

    // start lose show coroutine
    loseShow(completeCallBack)
    {
        this.loseCorout = new Coroutiner(this, this.loseShowC(completeCallBack));
        this.loseCorout.start();
    }

     // lose show coroutine
    *loseShowC(completeCallBack)
    {
        this.soundController.playClip('lose_clip', false);
        console.log('lose show, spinCount: ' + this.spinCount);
        console.log('play lose sound');  // play sound loseSound
        this.slotPlayer.addLevelProgress(this.loseSpinLevelProgress);
        this.playFreeSpins = (this.slotControls.autoPlayFreeSpins && this.slotControls.hasFreeSpin());
        this.reelSpin = false;
        console.log('enable background music');  // restore background music
        console.log('wait for popups'); 
        /*
        if (this.slotControls.auto && this.slotControls.autoSpinsCounter >= this.slotControls.autoSpinCount)
        {
            this.slotControls.resetAutoSpinsMode();
        }
        */
        yield* this.wait_ms(1000);  // wait 1 sec before call completeCallBack
        completeCallBack(this.slotControls.auto || this.playFreeSpins);
    }

    handleAnimation(){
        if(!this.handle) return;
        if(this.hAnim) return;
        this.hAnim = true;

        var sA_0 = new SequencedActions(); 
        var sA_1 = new SequencedActions(); 

        let hBPosY_0 = this.handleBall.y;
        let hBPosY_1 = this.handleBall.y + 305;
        let hBPosX = this.handleBall.x;
        let aTime = 200;

        sA_0.add((callBack) =>{
            new SimpleTweenFloat(this, 1.0, 0, aTime,                                                        
            (v, dv) =>{ this.handle.setScale(1, v);},   
            ()=> { callBack(); });
        }, this);
        sA_0.add((callBack) =>{
            new SimpleTweenFloat(this, 0, 1.0, aTime,                                                       
            (v, dv) =>{ this.handle.setScale(1, v);},   
            ()=> {this.handle.setScale(1,1); callBack(); });
        }, this);
        sA_0.start();

        sA_1.add((callBack) =>{
            new SimpleTweenFloat(this, hBPosY_0, hBPosY_1, aTime,                                                        
            (v, dv) =>{ this.handleBall.setPosition(hBPosX, v);},   
            ()=> { callBack(); });
        }, this);
        sA_1.add((callBack) =>{
            new SimpleTweenFloat(this, hBPosY_1, hBPosY_0, aTime,                                                       
                (v, dv) =>{ this.handleBall.setPosition(hBPosX, v);},    
            ()=> { this.hAnim = false; this.handleBall.setPosition(hBPosX, hBPosY_0); callBack(); });
        }, this);
        sA_1.start();
    }

    showBigWinMessage(winCoins, time)
    {
        var bwPU = this.guiController.showPopUp(slotConfig.createBigWinPUHandler);
        bwPU.messageText.text = formatCurrencyAmount(winCoins);
        if(time && time > 0) this.timeoutMess = setTimeout(()=>{this. guiController.closePopUp(bwPU); if(this.timeoutMess) clearTimeout(this.timeoutMess);}, time);
    }

    showWinCoinsMessage(winCoins, time)
    {    
        var winLabel = (window.ChinaSlotCurrency && window.ChinaSlotCurrency.isStarsMode())
            ? 'Your win: ' + winCoins + ' Stars!'
            : 'Your win: ' + winCoins + ' coins!';
        var wMess = this.guiController.showMessage('Congratulation!', winLabel, this,
        ()=>{
            if(this.timeoutMess) clearTimeout(this.timeoutMess);
            this.timeoutMess = null; 
            this. guiController.closePopUp(wMess);});
            if(time && time > 0) this.timeoutMess = setTimeout(()=>{this. guiController.closePopUp(wMess);}, time);
    }

    showWinFreeSpinsMessage(winCoins, time)
    {
        var wMess = this.guiController.showMessage('Congratulation!', 'Your win: ' + winCoins + ' free spins!', this,
        ()=>{
            if(this.timeoutMess) clearTimeout(this.timeoutMess);
            this.timeoutMess = null; 
            this. guiController.closePopUp(wMess);});
            if(time && time > 0) this.timeoutMess = setTimeout(()=>{this. guiController.closePopUp(wMess);}, time);
    }

    showJackpotWinMessage(winCoins, time)
    {
        var jpPU = this.guiController.showPopUp(slotConfig.createJackpotWinPUHandler);
        jpPU.messageText.text = formatCurrencyAmount(winCoins);
        this.showCoins(true);
        if(time && time > 0) this.timeoutMessJP = setTimeout(()=>{
            this. guiController.closePopUp(jpPU); 
            this.showCoins(false); 
            if(this.timeoutMessJP) clearTimeout(this.timeoutMessJP);}, time);
    }

    lampsBlink(blink)
    {
        if(!this.lampsArray) return;
        if(blink && !this.lampsIntervalID )
        {
            this._lampsOn = false;
            this.lampsIntervalID = setInterval(()=>
            {
                this.lampsArray.forEach((l)=>{l.setOn(this._lampsOn);});
                this._lampsOn = !this._lampsOn;
            }, 1000);
        }
       else if(!blink && this.lampsIntervalID)
       {
            clearInterval(this.lampsIntervalID);
            this.lampsArray.forEach((l)=>{l.setOn(true);});
            this.lampsIntervalID = null;
       }
    }

    // show coins particles
    showCoins(show)
    {
        if(show && this.coinParticles){
        this.coinsEmitter = this.coinParticles.createEmitter({
            x: this.centerX,
            y: -100,
            frame: 0,
            quantity: 3,
            frequency: 200,
            angle: { min: -30, max: 30 },
            speedX:  { min: -200, max: 200 },
            speedY: { min: -100, max: -200 },
            scale: { min: 0.3, max: 0.5 },
            gravityY: 400,
            lifespan: { min: 10000, max: 15000 },
            particleClass: AnimatedCoinParticle
        });
    }
    else {
        if(this.coinsEmitter!=null)
            {
                this.coinsEmitter.stop();
            }
        }
    }
}

// ---helper functions--- 

// return symbol data from the config_.js file
function getSymboldData(_slotConfig, spriteName)
{
    for(var si = 0; si < _slotConfig.symbols.length; si++)
    {
            if(_slotConfig.symbols[si].name === spriteName) return _slotConfig.symbols[si];
    }
    return null;
} 

function spinReels(reels, _slotConfig, completeCallback, forcedOrderPositions){

    var pA = new ParallelActions();
    var ri = 0;
    reels.forEach((r)=>{
        pA.add((callBack)=>
        {
            var rand = (forcedOrderPositions && forcedOrderPositions[ri] !== undefined) ? forcedOrderPositions[ri] : ((_slotConfig.reels_simulate && _slotConfig.reels_simulate[ri] >= 0) ? _slotConfig.reels_simulate[ri] : r.getRandomOrderPosition());
            r.spin(rand, ()=>{callBack();}); 
            ri++;
        });         
    });
    pA.start(completeCallback);
}

function createFullPaytable(payTable, useWild)
{
    var payTableFull = [];
    for (var j = 0; j < payTable.length; j++)
    {
        payTableFull.push(payTable[j]);
        var wildLines = payTable[j].getWildLines();
        if (useWild) wildLines.forEach((wl)=>{payTableFull.push(wl);}); 
    }
    return payTableFull;
}

function getTime() {
    //make a new date object
    let d = new Date();

    //return the number of milliseconds since 1 January 1970 00:00:00.
    return d.getTime();
}

if (typeof globalThis !== "undefined") {
    globalThis.SlotGame = SlotGame;
}
