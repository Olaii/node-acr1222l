# Node.js wrapper for ACR1222L NFC reader

Library for easier connecting and management of ACR1222L NFC reader. This library is tested on Windows and Linux.

To use this module read OS specific notes, then install with:

    npm install acr1222l

## Windows installation steps

1. First install required build tools:

        npm install --global --production windows-build-tools

2. Run npm install

3. Install Reader drivers

4. Disable Windows Smart Card Plug and Play:

    1. Click Start, type **gpedit.msc** in the Search programs and files box, and then press ENTER.
    2. In the console tree under **Computer Configuration**, click **Administrative Templates**.
    3. In the details pane, double-click **Windows Components**, and then double-click **Smart Card**.
    4. Right-click **Turn on Smart Card Plug and Play service**, and then click Edit. Click **Disabled**, and then click `OK`.
    5. Right-click **Turn on certificate propagation from smart card**, and then click Edit. Click **Disabled**, and then click `OK`.
    6. Right-click **Turn on root certificate propagation from smart card**, and then click Edit. Click **Disabled**, and then click `OK`.

## Linux installation steps

1. Install dependencies:

        sudo apt-get install libpcsclite-dev pcscd

2. Then check that pcscd is running:

        sudo service pcscd status
        sudo service pcscd start # if not yet running


## Use in nw.js

To use the library inside nw.js project you will have to rebuild the package with `nw-gyp`. 

First you need to install the `nw-gyp`. On Windows you have to run this with administrator rights.

        npm install -g nw-gyp

Manually rebuild the `pcsc` library. 

        cd node_modules/@pokusew/pcsclite
        
        nw-gyp configure --target=0.20.3   // use the appropriate Nw.js version
        nw-gyp rebuild --target=0.20.3

## Usage of the library


### Debugging

For debug purposes you can turn on verbose mode with the following code:

        var nfcReader = require('acr1222l');

        nfcReader.debug();  // turn on verbose

### Initialization

When initializing you have to pass in the **error_callback** function. It will be called in case of an error. Possible
error codes are:

 - READER_REMOVED
 - READER_ERROR
 - PCSC_ERROR

Other possible parameters during init are:
  - **error_callback** - *function* to be called upon errors
  - **use_fast_read** - *boolean* if the reader should send FAST_READ command or just READ
  - **user_space_start** - *hex* default value *0x04* for NTAG213. Start page of the card user space
  - **user_space_end** - *hex* default value *0x27* for NTAG213. End page of the card user space

Init method returns a **Promise**. Continue working with the reader only after the init has completed the initialization.

Sample code:

        var nfcReader = require('acr1222l');

        nfcReader.init(nfc_error_callback); //initialize

        function nfc_error_callback(err) {
            console.log('NFC ERROR CODE:', err.error_code);
            console.log('NFC ERROR MESSAGE:', err.error);
        }

### Write to LCD screen

Write to LCD is used to write a ASCII string to the screen with maximum lenght 16 chars each. Write will also turn on
LCD backlight.

Write call returns a **Promise**.

Sample code:

        nfcReader.writeToLCD('First line text', 'Second line text');


### Clear LCD screen
Will clear LCD text and turn off the backlight.

Clear call returns a **Promise**.

Sample code:

        nfcReader.clearLCD();


### Read NDEF data

This method will invoke FAST_READ or READ command on the card, based on the *init* settings provided and return an object
containing raw byte data, uuid and NDEF message.

This method returns a **Promise**. It will resolve once a valid card is presented. In case the card read fails, it will continue
reading until a successful read is completed and NDEF returned.

Return object:

        {
           original_bytes: <Buffer>,
           uuid_bytes: <Buffer>,
           ndef: <string>,
           uuid: <string>
        }

Sample code:

        ndef.readNDEF().then(function(data) {
            console.log('NDEF', data.ndef);
            console.log('UUID', data.uuid);
        });

### Stop NDEF read

To stop the read process. Returns a **Promise**.

        ndef.stopNDEFRead()

### Read UUID

Read card UUID.
Returns a **Promise** of a <Buffer>.

        ndef.readUUID();

### Stop UUID read

To stop the read process. Returns a **Promise**.

        ndef.stopUUIDRead()

### Turn on/off the backlight

Returns a **Promise**.

        ndef.backlightON();

        ndef.backlightOFF();
