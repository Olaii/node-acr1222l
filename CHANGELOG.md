# Changelog

## **v0.6.2* - 27.5.2025

- fix reader stuck in frozen state due to CTRL_PROTOCOL connection error
- small code fix
- fixed typos

## **v0.6.1* - 2.8.2023

- command in progress fixes

## **v0.6.0* - 18.7.2023

- fixed multiple end events when invalid readers are found
- fixed _wrapCommands to throw errors,
- changed init resolve to not wait for a reader,
- added callback function
- added READER_FOUND and READER_END callbacks
- added jsdocs to functions,
- added hasReader function
- added closePCSC function to help restart the service
- added sanity check in transmit functions
- added rejectWaitingRequestsCallbacks to reject all waiting callbacks
- worked on logger messages,
- worked on reader_util
- worked on DESede and exceptions
- flipped some ifs around
- replaced var with let or const
- styled examples
- formatted files
- automatically restart pcsc
- updated readUUID example to handle reader unplug
- pcsc_instance is now global variable so it can be restarted
- clear reader variable when reader is unplugged
- moved connection logic to handleStatusChange
- made _connect and _disconnect internal functions
- made performCardPresentCallbacks a function
- wrap LCD commands to prevent double calls which lead to invalidHandle error

## **Init* - 6.3.2017
