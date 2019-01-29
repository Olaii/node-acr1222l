# Node.js wrapper for ACR1222L NFC reader

Library for easier connecting and management of ACR1222L NFC reader. This library is tested on Windows and Linux.

To use this module read OS specific notes, then install with:

    npm install acr1222l

## Windows installation steps

1. First install required build tools:

        npm install --global --production windows-build-tools

2. Run npm install

3. Install Reader drivers

4. Disable Windows Smart Card Plug and Play (optional):

    1. Click Start, type **gpedit.msc** in the Search programs and files box, and then press ENTER.
    2. In the console tree under **Computer Configuration**, click **Administrative Templates**.
    3. In the details pane, double-click **Windows Components**, and then double-click **Smart Card**.
    4. Right-click **Turn on Smart Card Plug and Play service**, and then click Edit. Click **Disabled**, and then click `OK`.
    5. Right-click **Turn on certificate propagation from smart card**, and then click Edit. Click **Disabled**, and then click `OK`.
    6. Right-click **Turn on root certificate propagation from smart card**, and then click Edit. Click **Disabled**, and then click `OK`.

## Linux installation steps

1. Install dependencies:

        sudo apt-get install libpcsclite-dev pcscd

2. Install drivers:

        https://www.acs.com.hk/download-driver-unified/10312/ACS-Unified-PKG-Lnx-116-P.zip

3. Then check that pcscd is running:

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

Examples of the library usage are also available under the *examples* folder.

### Debugging

For debug purposes you can turn on verbose mode with the following code:

        var reader = require('acr1222l');

        await reader.initialize(error_cb, debug=true);

### Initialization

When initializing you have to pass in the **error_callback** function. It will be called in case of an error. Possible
error codes are:

 - READER_REMOVED
 - READER_ERROR
 - PCSC_ERROR

Other init parameters during are:
  - **error_callback** - *function* to be called upon errors
  - **debug** - *boolean* should the library output logs to console


Init method returns a **Promise**. Continue working with the reader only after the init has completed the initialization.

Sample code:

        var reader = require('acr1222l');

        reader.init(nfc_error_callback); //initialize

        function nfc_error_callback(err) {
            console.log('NFC ERROR CODE:', err.error_code);
            console.log('NFC ERROR MESSAGE:', err.error);
        }

### Write to LCD screen

Write to LCD is used to write a ASCII string to the screen with maximum lenght 16 chars each. Write will also turn on
LCD backlight.

Write call returns a **Promise**.

Sample code:

        reader.writeToLCD('First line text', 'Second line text');


### Clear LCD screen
Will clear LCD text and turn off the backlight.

Clear call returns a **Promise**.

Sample code:

        reader.clearLCD();


### Read NDEF data

This method will invoke FAST_READ command on the card and return an object
containing raw byte data, uuid and NDEF message.

This method returns a **Promise**. It will resolve once a valid card is presented. In case the card read fails, it will continue
reading until a successful read is completed and NDEF returned.


Call parameters:
  - **addr_start** - *hex* - Start address on the card. Defaults to 0x04
  - **addr_end** - *hex* - End address on the card. Defaults to 0x27


Return object:

        {
           original_bytes: <Buffer>,
           uuid_bytes: <Buffer>,
           ndef: <string>,
           uuid: <string>
        }

Sample code:

        reader.readNDEF(addr_start=0x04, addr_end=0x27).then(function(data) {
            console.log('NDEF', data.ndef);
            console.log('UUID', data.uuid);
        });

or with async/await

        const data = reader.readNDEF(addr_start=0x04, addr_end=0x27)

        console.log('NDEF', data.ndef);
        console.log('UUID', data.uuid);

### Stop NDEF read

To stop the read process. Returns a **Promise**.

        reader.stopNDEFRead()

### Read UUID

Read card UUID.
Returns a **Promise** of a <Buffer>.

        reader.readUUID();

### Stop UUID read

To stop the read process. Returns a **Promise**.

        reader.stopUUIDRead()

### Turn on/off the backlight

Returns a **Promise**.

        reader.turnOnBacklight();

        reader.turnOffBacklight();


### Authenticate

Will issue an authenticate call to the card (0x1b). Upon successful authentication the function call will return
a 2 byte PACK. If the authentication has failed error will be thrown.

Call parameters:
  - **pwd** - *Buffer* - card password

        await reader.authenticate(Buffer([0xFF, 0xFF, 0xFF, 0xFE]));


### Read Bytes

Should you need to read bytes directly from the card.

Call parameters:
  - **addr** - *hex* - start address
  - **num_bytes** - *int* - number of bytes to read. Usually set to 16 for a single read.


        // Read 16 bytes
        const data = await reader.readBytes(addr=0x04, num_bytes=16)


### Stop Read Bytes

Read bytes will wait until there is a card present. To stop reading call this function.

        await reader.stopReadBytes()


### Fast Read

Read all bytes between two addresses.

Call parameters:
  - **addr_start** - *hex* - start addr
  - **addr_end** - *hex* - end addr

        const data = await reader.fastRead(addr_start=0x04, addr_end=0x27)

### Write Buffer

Write bytes to the card.

Call parameters:
  - **buffer** - *hex* - bytes to write - usually 8
  - **addr** - *hex* - start address where to write

        await reader.writeBuffer(buff, addr)


### Stop Write Buffer

Write will wait for the card to be present. To stop call this function

        await reader.stopWriteBuffer()
